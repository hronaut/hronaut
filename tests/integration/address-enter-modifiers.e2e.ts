import { createServer } from 'node:http'
import { closeFixtureServer } from './fixtures.js'
import { expect, test } from './capability-fixtures.js'

type Tab = { id: string; url: string; mcpGroupId?: string }
type State = { tabs: Tab[]; activeTabId?: string }

test('Alt+Enter and Alt+Shift+Enter open the address in a new tab of the same workspace, and Ctrl+Enter adds www. and .com, as in Chrome', async ({ capabilities, appWindow, electronApp }) => {
  const { tabId } = capabilities
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>Next</title><p>${request.url}</p>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const next = `http://127.0.0.1:${address.port}/next`
  try {
    const state = async () => await appWindow.evaluate(`window.hronaut.getState()`) as State
    const shown = (await state()).tabs.find(tab => tab.id === tabId)!
    const addressBar = appWindow.getByRole('combobox', { name: 'Address' })

    await addressBar.fill(next)
    await addressBar.press('Alt+Enter')
    await expect.poll(async () => {
      const current = await state()
      const opened = current.tabs.find(tab => tab.url === next)
      return opened && { shown: current.activeTabId === opened.id, workspace: opened.mcpGroupId }
    }).toEqual({ shown: true, workspace: shown.mcpGroupId })
    // The tab the address was typed in keeps its page.
    expect((await state()).tabs.find(tab => tab.id === tabId)?.url).toBe(shown.url)
    await expect(addressBar).toHaveValue(next)

    // Alt+Shift+Enter opens it behind the shown tab, in the same workspace, and keeps the typed text.
    const behind = `${next}?behind`
    const shownTabId = (await state()).activeTabId
    await addressBar.fill(behind)
    await addressBar.press('Alt+Shift+Enter')
    await expect.poll(async () => {
      const current = await state()
      const opened = current.tabs.find(tab => tab.url === behind)
      return opened && { shown: current.activeTabId === opened.id, workspace: opened.mcpGroupId }
    }).toEqual({ shown: false, workspace: shown.mcpGroupId })
    expect((await state()).activeTabId).toBe(shownTabId)
    await expect(addressBar).toHaveValue(behind)
    await addressBar.press('Escape')

    const blankPages = () => electronApp.evaluate(({ webContents }) => (
      webContents.getAllWebContents().filter((contents) => contents.getURL() === 'about:blank').map((contents) => contents.id)
    ))
    const earlierBlankPages = await blankPages()
    await appWindow.getByRole('button', { name: 'New tab' }).click()
    await expect.poll(async () => (await blankPages()).filter((id) => !earlierBlankPages.includes(id)).length).toBe(1)
    const newPage = (await blankPages()).find((id) => !earlierBlankPages.includes(id))!
    // The site is out of reach here: note what the tab asks for, and cancel it.
    await electronApp.evaluate(({ webContents }, newPage) => {
      const page = webContents.fromId(newPage)
      if (!page) throw new Error('New tab was not found')
      const globalState = globalThis as typeof globalThis & { __hronautRequests?: string[] }
      globalState.__hronautRequests = []
      page.session.webRequest.onBeforeRequest({ urls: ['*://www.hronaut-enter-test.com/*'] }, (details, callback) => {
        globalState.__hronautRequests?.push(details.url)
        callback({ cancel: true })
      })
    }, newPage)
    const requests = () => electronApp.evaluate(() => (globalThis as typeof globalThis & { __hronautRequests?: string[] }).__hronautRequests)
    const tabCount = (await state()).tabs.length
    await addressBar.fill('hronaut-enter-test/news')
    await addressBar.press('Control+Enter')
    await expect.poll(requests).toEqual(['https://www.hronaut-enter-test.com/news'])
    // In the same tab: no other tab was opened for it.
    expect((await state()).tabs).toHaveLength(tabCount)
  } finally {
    await closeFixtureServer(server)
  }
})
