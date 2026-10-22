import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }
type Press = { button: 'left' | 'middle' | 'right', modifiers?: Array<'control' | 'meta'> }

test('opens tabs from a page\'s links beside that page, in the order they were opened', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/app') {
      response.end('<!doctype html><title>App</title><p><a id="one" href="/one">One</a> <a id="two" href="/two">Two</a> <a id="three" href="/three" target="_blank">Three</a> <a id="four" href="/four">Four</a></p>')
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
    // The app page is shown and the mail page is the workspace's last tab, so tabs the app opens no longer land last.
    // The workspace's own first tab, about:blank, comes before them and is left out below.
    await appWindow.evaluate(`window.hronaut.getState().then((state) => {
      const app = state.tabs.find((tab) => tab.url.endsWith('/app'))
      const mail = state.tabs.find((tab) => tab.url.endsWith('/mail'))
      return window.hronaut.reorderTab(app.id, mail.id, 'before')
    })`)
    const order = async () => (await appWindow.evaluate(`window.hronaut.getState()`) as { tabs: Array<{ url: string, active: boolean, mcpGroupId?: string }> })
      .tabs.filter(tab => tab.mcpGroupId === workspace && tab.url.startsWith(origin)).map(tab => `${new URL(tab.url).pathname}${tab.active ? '*' : ''}`)
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

    // A link opened behind with Ctrl/Cmd+click went after the workspace's last tab.
    await press('#one', { button: 'left', modifiers: [process.platform === 'darwin' ? 'meta' : 'control'] })
    await expect.poll(order).toEqual(['/app*', '/one', '/mail'])

    // Open Link in New Tab and a middle-click go after the tabs the page already opened.
    await electronApp.evaluate(({ Menu }) => {
      ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })
    await press('#two', { button: 'right' })
    await expect.poll(() => electronApp.evaluate(() => {
      const item = (globalThis as MenuGlobal).__hronautContextMenu?.getMenuItemById('open-link-new-tab')
      if (!item?.click) return false
      ;(item.click as unknown as () => void)()
      return true
    })).toBe(true)
    await expect.poll(order).toEqual(['/app*', '/one', '/two', '/mail'])
    await press('#four', { button: 'middle' })
    await expect.poll(order).toEqual(['/app*', '/one', '/two', '/four', '/mail'])

    // A target="_blank" link opens in front, right after the page.
    await press('#three', { button: 'left' })
    await expect.poll(order).toEqual(['/app', '/three*', '/one', '/two', '/four', '/mail'])
  } finally {
    await closeFixtureServer(server)
  }
})
