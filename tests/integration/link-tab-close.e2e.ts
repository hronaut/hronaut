import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type Press = { button: 'left' | 'middle' }

test('closing a tab opened from a page shows that page\'s next tab, then the page, until the person moves on', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/app') {
      response.end('<!doctype html><title>App</title><p><a id="one" href="/one" target="_blank">One</a> <a id="two" href="/two">Two</a> <a id="three" href="/three">Three</a></p>')
    } else {
      response.end(`<!doctype html><title>${request.url}</title>`)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Links', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Links')!.id
    const open = (path: string) => appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(origin + path)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    await open('/mail')
    await open('/app')
    // The workspace's own first tab, about:blank, comes before these and is left out below.
    await appWindow.evaluate(`window.hronaut.getState().then((state) => {
      const app = state.tabs.find((tab) => tab.url.endsWith('/app'))
      const mail = state.tabs.find((tab) => tab.url.endsWith('/mail'))
      return window.hronaut.reorderTab(app.id, mail.id, 'before')
    })`)
    const tabs = async () => (await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ id: string, url: string, active: boolean, mcpGroupId?: string }> })
      .tabs.filter(tab => tab.mcpGroupId === workspace && tab.url.startsWith(origin))
    const order = async () => (await tabs()).map(tab => `${new URL(tab.url).pathname}${tab.active ? '*' : ''}`)
    const tabId = async (path: string) => (await tabs()).find(tab => new URL(tab.url).pathname === path)!.id
    // The person's own clicks in the tab strip and on its close buttons.
    const select = async (path: string) => appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(await tabId(path))})`)
    const close = async (path: string) => appWindow.evaluate(`window.hronaut.closeTab(${JSON.stringify(await tabId(path))})`)
    await expect.poll(order).toEqual(['/app*', '/mail'])

    const press = (selector: string, input: Press) => electronApp.evaluate(async ({ webContents }, { url, selector, input }) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
      if (!page) throw new Error('App page web contents was not found')
      const point = await page.executeJavaScript(`(() => {
        const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
        return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
      })()`)
      page.focus()
      page.sendInputEvent({ type: 'mouseDown', clickCount: 1, ...input, ...point })
      page.sendInputEvent({ type: 'mouseUp', clickCount: 1, ...input, ...point })
    }, { url: `${origin}/app`, selector, input })

    // A target="_blank" tab showed the mail tab to its right when it closed, not the page it came from.
    await press('#one', { button: 'left' })
    await expect.poll(order).toEqual(['/app', '/one*', '/mail'])
    await close('/one')
    await expect.poll(order).toEqual(['/app*', '/mail'])

    // Tabs opened behind are read one after another, then the page shows again.
    await press('#two', { button: 'middle' })
    await press('#three', { button: 'middle' })
    await expect.poll(order).toEqual(['/app*', '/two', '/three', '/mail'])
    await select('/three')
    await close('/three')
    await expect.poll(order).toEqual(['/app', '/two*', '/mail'])
    await close('/two')
    await expect.poll(order).toEqual(['/app*', '/mail'])

    // Going to an unrelated tab first is another task, so the tab beside it shows, as in Chrome.
    await press('#two', { button: 'middle' })
    await expect.poll(order).toEqual(['/app*', '/two', '/mail'])
    await select('/mail')
    await select('/two')
    await close('/two')
    await expect.poll(order).toEqual(['/app', '/mail*'])

    // A tab the page opens in front starts another task too, so the tabs it opened behind no longer count.
    await select('/app')
    await press('#two', { button: 'middle' })
    await expect.poll(order).toEqual(['/app*', '/two', '/mail'])
    await press('#one', { button: 'left' })
    await expect.poll(order).toEqual(['/app', '/one*', '/two', '/mail'])
    await close('/one')
    await expect.poll(order).toEqual(['/app*', '/two', '/mail'])

    // So does sending a tab of the workspace to another address.
    await press('#three', { button: 'middle' })
    await expect.poll(order).toEqual(['/app*', '/three', '/two', '/mail'])
    await appWindow.evaluate(`window.hronaut.navigate({ url: ${JSON.stringify(`${origin}/five`)}, tabId: ${JSON.stringify(await tabId('/two'))} })`)
    await expect.poll(order).toEqual(['/app*', '/three', '/five', '/mail'])
    await select('/three')
    await close('/three')
    await expect.poll(order).toEqual(['/app', '/five*', '/mail'])
  } finally {
    await closeFixtureServer(server)
  }
})
