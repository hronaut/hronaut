import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string }> }

// The page's context menu had no Copy link to highlight, as Chrome's has. The link it copies opens the page scrolled to
// the selected text.

test('Copy link to highlight copies a link that opens the page at the selected text, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(`<!doctype html><title>Highlight fixture</title>
      <h1 id="top">Guide</h1>
      <div style="height: 3000px"></div>
      <p id="target" style="font: 24px sans-serif">Run   npm ci --ignore-scripts before the build.</p>
      <div style="height: 3000px"></div>
      <div id="across"><p>Agents get their own browser.</p><p>Every project keeps its sign-ins apart.</p></div>
      <div style="height: 3000px"></div>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const state = async () => await appWindow.evaluate(`window.hronaut.getState()`) as State
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/page#top`)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === tabId)?.url).toBe(`${origin}/page#top`)

    // The person selects text on the page and right-clicks it, then chooses the item.
    const choose = (element: string) => electronApp.evaluate(async ({ Menu, webContents }, { origin, element }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === `${origin}/page#top`)
      if (!page) throw new Error('Page web contents was not found')
      const point = await page.mainFrame.executeJavaScript(`(() => {
        const element = document.getElementById(${JSON.stringify(element)})
        element.scrollIntoView({ block: 'center' })
        getSelection().selectAllChildren(element)
        const box = element.firstElementChild?.getBoundingClientRect() ?? element.getBoundingClientRect()
        return { x: Math.round(box.left + 20), y: Math.round(box.top + box.height / 2) }
      })()`) as { x: number, y: number }
      const popup = Menu.prototype.popup
      let menu: Electron.Menu | undefined
      Menu.prototype.popup = function (): void { menu = this }
      try {
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
        for (let waited = 0; !menu && waited < 5_000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50))
      } finally {
        Menu.prototype.popup = popup
      }
      const ids = menu?.items.map(item => item.id).filter(Boolean).slice(0, 3)
      const item = menu?.getMenuItemById('copy-link-to-highlight')
      if (!item?.click) throw new Error(`Missing Copy link to highlight in the page's context menu: ${JSON.stringify(ids)}`)
      ;(item.click as unknown as () => void)()
      return { label: item.label, ids }
    }, { origin, element })
    const clipboard = () => electronApp.evaluate(({ clipboard }) => clipboard.readText())

    expect(await choose('target')).toEqual({ label: 'Copy Link to Highlight', ids: ['copy-selection', 'copy-link-to-highlight', 'search-selection'] })
    const link = `${origin}/page#top:~:text=Run%20npm%20ci%20%2D%2Dignore%2Dscripts%20before%20the%20build.`
    await expect.poll(clipboard).toBe(link)
    expect(await choose('across')).toMatchObject({ label: 'Copy Link to Highlight' })
    const across = `${origin}/page#top:~:text=Agents%20get%20their%20own%20browser.,project%20keeps%20its%20sign%2Dins%20apart.`
    await expect.poll(clipboard).toBe(across)

    // Each link opens the page with its text in view, not the page's own fragment at the top.
    for (const [opened, element] of [[link, 'target'], [across, 'across']] as const) {
      const shown = await appWindow.evaluate(async url => (await (window as unknown as { hronaut: { newTab(options: { url: string; active: boolean }): Promise<{ activeTabId?: string }> } }).hronaut.newTab({ url, active: true })).activeTabId, opened)
      await expect.poll(async () => (await state()).tabs.find(tab => tab.id === shown)?.url).toBe(opened)
      await expect.poll(() => electronApp.evaluate(async ({ webContents }, { opened, element }) => {
        const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === opened)
        if (!page || page.isLoading()) return 'loading'
        return await page.mainFrame.executeJavaScript(`(() => {
          const box = document.getElementById(${JSON.stringify(element)}).getBoundingClientRect()
          return box.top >= 0 && box.bottom <= innerHeight ? 'in view' : 'scrollY ' + scrollY
        })()`) as string
      }, { opened, element }), { timeout: 10_000 }).toBe('in view')
    }
  } finally {
    await closeFixtureServer(server)
  }
})
