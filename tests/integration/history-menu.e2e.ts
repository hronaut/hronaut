import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type CapturedMenus = { original: typeof Electron.Menu.buildFromTemplate; menus: Electron.Menu[]; popups: unknown[] }

test('Back and Forward list the pages they go through when right-clicked or held, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const titles: Record<string, string> = { '/one': 'One & only', '/two': 'Two', '/three': 'Three' }
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${(titles[request.url ?? ''] ?? '').replace('&', '&amp;')}</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  // The lists Hronaut builds, kept so the test can pick from them; each still opens as it would for the person.
  await electronApp.evaluate(({ Menu }) => {
    const scope = globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }
    const original = Menu.buildFromTemplate
    scope.__hronautHistoryMenus = { original, menus: [], popups: [] }
    Object.defineProperty(Menu, 'buildFromTemplate', {
      configurable: true,
      value: (template: Electron.MenuItemConstructorOptions[]) => {
        const menu = original.call(Menu, template)
        if (template.some((item) => item.id === 'show-full-history')) {
          scope.__hronautHistoryMenus!.menus.push(menu)
          const popup = menu.popup.bind(menu)
          menu.popup = (options?: Electron.PopupOptions) => {
            const { x, y } = options ?? {}
            scope.__hronautHistoryMenus!.popups.push({ x, y })
            popup(options)
          }
        }
        return menu
      }
    })
  })
  const menus = () => electronApp.evaluate(() => {
    const scope = globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }
    return scope.__hronautHistoryMenus!.menus.map((menu) => menu.items.map((item) => item.type === 'separator' ? '---' : item.label))
  })
  // Picks an item of the last list, as the person's click on it does, once the list is closed.
  const pick = (label: string) => electronApp.evaluate((_electron, label) => {
    const scope = globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }
    const menu = scope.__hronautHistoryMenus!.menus.at(-1)!
    menu.closePopup()
    const item = menu.items.find((candidate) => candidate.label === label)
    if (!item) throw new Error(`No ${label} in the list`)
    item.click()
  }, label)
  try {
    const path = async () => {
      const state = await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ id: string, url: string }> }
      const url = state.tabs.find(tab => tab.id === tabId)!.url
      return url.startsWith(origin) ? new URL(url).pathname : url
    }
    const visit = async (to: string) => {
      await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(origin + to)}, tabId: ${JSON.stringify(tabId)} })`)
      await expect.poll(path).toBe(to)
    }
    await visit('/one')
    await visit('/two')
    await visit('/three')
    const back = appWindow.getByRole('button', { name: 'Back', exact: true })
    const forward = appWindow.getByRole('button', { name: 'Forward', exact: true })
    await expect(back).toBeEnabled()

    // A right-click lists the pages Back goes through, nearest first, and goes nowhere by itself.
    await back.click({ button: 'right' })
    await expect.poll(menus).toHaveLength(1)
    const [firstList] = await menus()
    // The page the tab opened on comes after these.
    expect(firstList!.slice(0, 2)).toEqual(['Two', 'One && only'])
    expect(firstList!.slice(-2)).toEqual(['---', 'Show Full History'])
    const box = (await back.boundingBox())!
    const popup = await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }).__hronautHistoryMenus!.popups.at(-1))
    // It opens below the arrow, at its left edge.
    expect(popup).toEqual({ x: Math.round(box.x), y: Math.round(box.y + box.height) })
    expect(await path()).toBe('/three')

    // Picking a page goes straight to it.
    await pick('One && only')
    await expect.poll(path).toBe('/one')

    // Holding Forward lists the pages it goes through; letting go does not also go forward.
    await expect(forward).toBeEnabled()
    const forwardBox = (await forward.boundingBox())!
    await appWindow.mouse.move(forwardBox.x + forwardBox.width / 2, forwardBox.y + forwardBox.height / 2)
    await appWindow.mouse.down()
    await expect.poll(menus).toHaveLength(2)
    await appWindow.mouse.up()
    expect((await menus())[1]).toEqual(['Two', 'Three', '---', 'Show Full History'])
    await appWindow.waitForTimeout(500)
    expect(await path()).toBe('/one')

    // Show Full History opens the history panel, and leaves it open when asked again.
    await pick('Show Full History')
    const historyPanel = appWindow.getByRole('dialog', { name: 'Browsing history' })
    await expect(historyPanel).toBeVisible()
    await forward.click({ button: 'right' })
    await expect.poll(menus).toHaveLength(3)
    await pick('Show Full History')
    await appWindow.waitForTimeout(300)
    await expect(historyPanel).toBeVisible()

    // So does the keyboard's menu key, or Shift+F10, on a focused arrow.
    await forward.focus()
    await appWindow.keyboard.press('Shift+F10')
    await expect.poll(menus).toHaveLength(4)
    expect((await menus())[3]).toEqual(['Two', 'Three', '---', 'Show Full History'])
    await electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }).__hronautHistoryMenus!.menus.at(-1)!.closePopup())

    // A plain click still goes forward.
    await forward.click()
    await expect.poll(path).toBe('/two')
  } finally {
    await electronApp.evaluate(({ Menu }) => {
      const scope = globalThis as typeof globalThis & { __hronautHistoryMenus?: CapturedMenus }
      const control = scope.__hronautHistoryMenus
      if (control) {
        for (const menu of control.menus) menu.closePopup()
        Object.defineProperty(Menu, 'buildFromTemplate', { configurable: true, value: control.original })
      }
      delete scope.__hronautHistoryMenus
    }).catch(() => undefined)
    await closeFixtureServer(server)
  }
})
