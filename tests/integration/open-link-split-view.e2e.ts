import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type MenuGlobal = typeof globalThis & { __hronautContextMenu?: Electron.Menu }
type ShownTabs = { activeTabId: string | null, splitView?: { firstTabId: string, secondTabId: string }, tabs: Array<{ id: string, url: string, mcpGroupId?: string }> }

// A link's menu had no Open Link in Split View, which Chrome's has to open the link in a new tab beside the page.

test('opens a link in a new tab beside the page, which keeps the keyboard, and replaces the other side of a split', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    if (request.url === '/guide') {
      response.end('<!doctype html><title>Guide</title><p><a id="api" href="/api">API</a> <a id="faq" href="/faq">FAQ</a></p>')
    } else {
      response.end(`<!doctype html><title>${request.url}</title>`)
    }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing fixture port')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Docs', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Docs')!.id
    await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/guide`)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
    const shown = async () => {
      const state = await appWindow.evaluate(`window.hronaut.getState()`) as ShownTabs
      const path = (id: string | undefined) => {
        const url = state.tabs.find(tab => tab.id === id)?.url
        return url ? new URL(url).pathname : undefined
      }
      return {
        active: path(state.activeTabId ?? undefined),
        split: state.splitView ? [path(state.splitView.firstTabId), path(state.splitView.secondTabId)] : null,
        open: state.tabs.filter(tab => tab.mcpGroupId === workspace && tab.url.startsWith(origin)).map(tab => new URL(tab.url).pathname)
      }
    }
    await expect.poll(shown).toEqual({ active: '/guide', split: null, open: ['/guide'] })
    // The page loaded, so its links can be right-clicked.
    await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
      webContents.getAllWebContents().find(contents => contents.getURL() === url)?.getTitle(), `${origin}/guide`)).toBe('Guide')

    await electronApp.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (): void {
        ;(globalThis as MenuGlobal).__hronautContextMenu = this
      }
    })
    const openBeside = async (selector: string): Promise<void> => {
      await electronApp.evaluate(async ({ webContents }, { url, selector }) => {
        ;(globalThis as MenuGlobal).__hronautContextMenu = undefined
        const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
        if (!page) throw new Error('Guide page web contents was not found')
        const point = await page.executeJavaScript(`(() => {
          const bounds = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect()
          return { x: Math.round(bounds.x + bounds.width / 2), y: Math.round(bounds.y + bounds.height / 2) }
        })()`)
        page.focus()
        page.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point })
        page.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point })
      }, { url: `${origin}/guide`, selector })
      await expect.poll(() => electronApp.evaluate(() => {
        const item = (globalThis as MenuGlobal).__hronautContextMenu?.getMenuItemById('open-link-split-view')
        if (!item?.click || !item.enabled) return null
        const label = item.label
        ;(item.click as unknown as () => void)()
        return label
      })).toBe('Open Link in Split View')
    }

    await openBeside('#api')
    await expect.poll(shown).toEqual({ active: '/guide', split: ['/guide', '/api'], open: ['/guide', '/api'] })
    // The link's page loaded, and the page the person was reading still has the keyboard.
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => {
      const contents = webContents.getAllWebContents()
      return {
        api: contents.find(candidate => candidate.getURL() === `${origin}/api`)?.getTitle(),
        guideFocused: contents.find(candidate => candidate.getURL() === `${origin}/guide`)?.isFocused()
      }
    }, origin)).toEqual({ api: '/api', guideFocused: true })

    // From a split, the new tab takes the other side; the tab it replaces stays open.
    await openBeside('#faq')
    await expect.poll(shown).toEqual({ active: '/guide', split: ['/guide', '/faq'], open: ['/guide', '/api', '/faq'] })
    await expect.poll(() => electronApp.evaluate(({ webContents }, origin) => {
      const contents = webContents.getAllWebContents()
      return {
        faq: contents.find(candidate => candidate.getURL() === `${origin}/faq`)?.getTitle(),
        guideFocused: contents.find(candidate => candidate.getURL() === `${origin}/guide`)?.isFocused()
      }
    }, origin)).toEqual({ faq: '/faq', guideFocused: true })
  } finally {
    await closeFixtureServer(server)
  }
})
