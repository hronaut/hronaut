import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'
import type { HronautApi, HronautBookmarksApi } from '../../src/shared/types.js'

type TestWindow = Window & { hronaut: HronautApi; hronautBookmarks: HronautBookmarksApi }

// Open tabs were kept out of the address bar, so a page open in another tab could only be opened again. Chrome offers
// Switch to this tab on such a row, reached with Tab, and lists the open tabs with @tabs.
test('switches to a bookmarked page\'s open tab from the address bar with Tab and Enter, a click, or @tabs, as in Chrome', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Switch ${request.url!.slice(1)}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address()
  if (!port || typeof port === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${port.port}`
  const docs = `${origin}/docs`
  try {
    const ids = await appWindow.evaluate(async url => {
      const api = window as unknown as TestWindow
      await api.hronautBookmarks.add(url, 'Docs bookmark')
      const docsTab = (await api.hronaut.newTab({ url, active: false })).tabs.find(tab => tab.url === url)!.id
      const shown = (await api.hronaut.newTab({ active: true })).activeTabId!
      return { docsTab, shown }
    }, docs)
    const state = () => appWindow.evaluate(() => (window as unknown as TestWindow).hronaut.getState())
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === ids.docsTab)?.title).toBe('Switch docs')
    const address = appWindow.getByRole('combobox', { name: 'Address' })
    const overlay = (script: string) => electronApp.evaluate(async ({ webContents }, script) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))
      return contents?.executeJavaScript(script) as Promise<unknown> | undefined
    }, script)
    const showSelected = async (id: string) => {
      await appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.selectTab(id), id)
      await expect.poll(async () => (await state()).activeTabId).toBe(id)
    }

    // Tab goes on from the highlighted row to its button, and Enter shows the tab.
    await address.fill('Docs bookmark')
    await expect(address).toHaveAttribute('aria-expanded', 'true')
    await expect.poll(() => overlay("document.querySelector('[role=option] .address-suggestion-switch')?.textContent ?? null")).toBe('Switch to this tab')
    await address.press('ArrowDown')
    await address.press('Tab')
    await expect(address).toBeFocused()
    await expect(address).toHaveAttribute('aria-activedescendant', /-switch$/u)
    const switchButton = appWindow.locator(`[id="${await address.getAttribute('aria-activedescendant')}"]`)
    await expect(switchButton).toHaveText('Switch to this tab: Docs bookmark')
    // The button is not one more row of the list a screen reader counts.
    await expect(switchButton).toHaveAttribute('role', 'button')
    await expect(appWindow.locator('#address-suggestions [role="option"]')).toHaveCount(1)
    await expect(appWindow.locator('#address-suggestions [role="option"]')).toHaveAttribute('aria-selected', 'true')
    // Chromium takes the button as the field's active descendant, which is what a screen reader announces.
    const accessibility = await appWindow.context().newCDPSession(appWindow)
    try {
      const { nodes } = await accessibility.send('Accessibility.getFullAXTree') as { nodes: Array<{
        backendDOMNodeId?: number
        role?: { value?: unknown }
        name?: { value?: unknown }
        properties?: Array<{ name: string; value: { relatedNodes?: Array<{ backendDOMNodeId: number }> } }>
      }> }
      const field = nodes.find(node => node.role?.value === 'combobox' && node.name?.value === 'Address')
      const target = field?.properties?.find(property => property.name === 'activedescendant')?.value.relatedNodes?.[0]?.backendDOMNodeId
      const active = nodes.find(node => target !== undefined && node.backendDOMNodeId === target)
      expect({ role: active?.role?.value, name: active?.name?.value }).toEqual({ role: 'button', name: 'Switch to this tab: Docs bookmark' })
    } finally {
      await accessibility.detach()
    }
    await expect.poll(() => overlay("Boolean(document.querySelector('.address-suggestion-switch.focused'))")).toBe(true)
    await address.press('Enter')
    await expect.poll(async () => (await state()).activeTabId).toBe(ids.docsTab)
    // No tab was opened or navigated for it.
    expect((await state()).tabs.filter(tab => tab.url === docs).map(tab => tab.id)).toEqual([ids.docsTab])
    expect((await state()).tabs.find(tab => tab.id === ids.shown)?.url).toBe('about:blank')

    // A click on the button, with real mouse input sent to the suggestions view.
    await showSelected(ids.shown)
    await address.fill('')
    await address.fill('Docs bookmark')
    await expect.poll(() => overlay("document.querySelector('.address-suggestion-switch') ? 'shown' : null")).toBe('shown')
    await electronApp.evaluate(async ({ webContents }) => {
      const contents = webContents.getAllWebContents().find(candidate => candidate.getURL().includes('address-overlay.html'))!
      const box = await contents.executeJavaScript("(() => { const r = document.querySelector('.address-suggestion-switch').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()") as { x: number; y: number }
      const at = { x: Math.round(box.x), y: Math.round(box.y), button: 'left' as const, clickCount: 1 }
      contents.sendInputEvent({ type: 'mouseDown', ...at })
      contents.sendInputEvent({ type: 'mouseUp', ...at })
    })
    await expect.poll(async () => (await state()).activeTabId).toBe(ids.docsTab)

    // @tabs lists the open tabs, and Enter on one shows it.
    await showSelected(ids.shown)
    await address.fill('@tabs switch docs')
    await expect.poll(() => overlay("[...document.querySelectorAll('[role=option]')].map(row => row.dataset.suggestionId + ' ' + row.querySelector('small').textContent).join('|')"))
      .toBe(`tab:${ids.docsTab} Open tab`)
    await address.press('ArrowDown')
    await address.press('Enter')
    await expect.poll(async () => (await state()).activeTabId).toBe(ids.docsTab)
    expect((await state()).tabs.filter(tab => tab.url === docs)).toHaveLength(1)

    // @tabs finds the tabs of every workspace, and Enter goes to another workspace's tab.
    const client = await appWindow.evaluate(async url => {
      const api = window as unknown as TestWindow
      const created = await api.hronaut.createWorkspace({ name: 'Client A', storage: 'scratch' })
      const workspace = created.mcpTabGroups.find(group => group.name === 'Client A')!.id
      const opened = await api.hronaut.newTab({ url, mcpGroupId: workspace, active: true })
      return { tab: opened.tabs.find(tab => tab.url === url)!.id, workspace }
    }, `${origin}/client`)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === client.tab)?.title).toBe('Switch client')
    await showSelected(ids.shown)
    expect((await state()).tabs.find(tab => tab.id === ids.shown)?.mcpGroupId).not.toBe(client.workspace)
    await address.fill('@tabs switch client')
    await expect.poll(() => overlay("[...document.querySelectorAll('[role=option]')].map(row => row.dataset.suggestionId).join('|')"))
      .toBe(`tab:${client.tab}`)
    await address.press('ArrowDown')
    await address.press('Enter')
    await expect.poll(async () => (await state()).activeTabId).toBe(client.tab)
    expect((await state()).tabs.filter(tab => tab.url === `${origin}/client`)).toHaveLength(1)

    // Enter on the row itself still opens the page in the tab shown, as before.
    await showSelected(ids.shown)
    await address.fill('Docs bookmark')
    await address.press('ArrowDown')
    await address.press('Enter')
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === ids.shown)?.url).toBe(docs)
    expect((await state()).activeTabId).toBe(ids.shown)
  } finally {
    await closeFixtureServer(server)
  }
})
