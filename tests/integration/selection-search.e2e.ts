import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string; mcpGroupId?: string }> }

test('Search Google for the selected text, or Go to a selected address, from the page context menu opens it beside the page, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Selection fixture</title><p id="topic" style="font: 24px sans-serif">Hronaut   agent\nbrowser</p>
      <p id="address" style="font: 24px sans-serif">http://${request.headers.host}/next</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const state = async () => await appWindow.evaluate(`window.hronaut.getState()`) as State
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/page`)}, tabId: ${JSON.stringify(tabId)} })`)
    await expect.poll(async () => (await state()).tabs.find(tab => tab.id === tabId)?.url).toBe(`${origin}/page`)
    const workspace = (await state()).tabs.find(tab => tab.id === tabId)!.mcpGroupId
    // Another tab follows the page, so that the results open beside the page rather than at the end.
    await appWindow.evaluate(`window.hronaut.newTab({ active: false, mcpGroupId: ${JSON.stringify(workspace)} })`)
    await expect.poll(async () => {
      const tabs = (await state()).tabs
      return tabs[tabs.findIndex(tab => tab.id === tabId) + 1]?.mcpGroupId
    }).toBe(workspace)
    // The search engine is out of reach here: note the searches the workspace asks for, and cancel them.
    await electronApp.evaluate(({ webContents }, origin) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(`${origin}/`))
      if (!page) throw new Error('Page web contents was not found')
      const globalState = globalThis as typeof globalThis & { __hronautSearches?: string[] }
      globalState.__hronautSearches = []
      page.session.webRequest.onBeforeRequest({ urls: ['https://www.google.com/*'] }, (details, callback) => {
        globalState.__hronautSearches?.push(details.url)
        callback({ cancel: true })
      })
    }, origin)
    const searches = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautSearches?: string[] }).__hronautSearches)

    // The person selects a paragraph of the page and right-clicks it, then chooses the item.
    const choose = (paragraph: string, itemId: string) => electronApp.evaluate(async ({ Menu, webContents }, { origin, paragraph, itemId }) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === `${origin}/page`)
      if (!page) throw new Error('Page web contents was not found')
      const point = await page.mainFrame.executeJavaScript(`(() => {
        const paragraph = document.getElementById(${JSON.stringify(paragraph)})
        getSelection().selectAllChildren(paragraph)
        const box = paragraph.getBoundingClientRect()
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
      const item = menu?.getMenuItemById(itemId)
      if (!item?.click) throw new Error(`Missing ${itemId} in the page's context menu`)
      const offered = ['search-selection', 'go-to-selection'].filter(id => menu?.getMenuItemById(id))
      ;(item.click as unknown as () => void)()
      return { label: item.label, offered }
    }, { origin, paragraph, itemId })
    expect(await choose('topic', 'search-selection')).toEqual({ label: 'Search Google for “Hronaut agent browser”', offered: ['search-selection'] })

    await expect.poll(searches).toEqual(['https://www.google.com/search?q=Hronaut%20agent%20browser'])
    await expect.poll(async () => {
      const current = await state()
      const results = current.tabs.find(tab => tab.url.startsWith('https://www.google.com/'))
      return results && {
        shown: current.activeTabId === results.id,
        workspace: results.mcpGroupId,
        besidePage: current.tabs.indexOf(results) === current.tabs.findIndex(tab => tab.id === tabId) + 1
      }
    }).toEqual({ shown: true, workspace, besidePage: true })

    // A selected address opens instead, as Chrome's Go to does.
    await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(tabId)})`)
    await expect.poll(async () => (await state()).activeTabId).toBe(tabId)
    expect(await choose('address', 'go-to-selection')).toEqual({ label: `Go to ${origin}/next`, offered: ['go-to-selection'] })
    await expect.poll(async () => {
      const current = await state()
      const next = current.tabs.find(tab => tab.url === `${origin}/next`)
      return next && { shown: current.activeTabId === next.id, workspace: next.mcpGroupId }
    }).toEqual({ shown: true, workspace })
    expect(await searches()).toHaveLength(1)
  } finally {
    await closeFixtureServer(server)
  }
})
