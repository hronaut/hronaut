import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type State = { activeTabId?: string; tabs: Array<{ id: string; url: string; mcpGroupId?: string }> }

test('Search Google for the selected text from the page context menu opens the results beside the page, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<!doctype html><title>Selection fixture</title><p id="topic" style="font: 24px sans-serif">Hronaut   agent\nbrowser</p>')
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

    // The person selects the paragraph and right-clicks it.
    const label = await electronApp.evaluate(async ({ Menu, webContents }, origin) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL().startsWith(`${origin}/`))
      if (!page) throw new Error('Page web contents was not found')
      const point = await page.mainFrame.executeJavaScript(`(() => {
        const topic = document.getElementById('topic')
        getSelection().selectAllChildren(topic)
        const box = topic.getBoundingClientRect()
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
      const item = menu?.getMenuItemById('search-selection')
      if (!item?.click) throw new Error('Missing Search for the selection in the page\'s context menu')
      ;(item.click as unknown as () => void)()
      return item.label
    }, origin)
    expect(label).toBe('Search Google for “Hronaut agent browser”')

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
  } finally {
    await closeFixtureServer(server)
  }
})
