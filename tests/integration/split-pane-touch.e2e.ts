import { createServer } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// In split view, a click on the other pane's page makes it the active pane, but a touch on it did not, so the address
// field, the toolbar and Ctrl/Cmd+W still acted on the pane the person had left.

test('makes the other pane of the split view active when the person touches its page', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url}</title><body style="margin:0;min-height:100vh">${request.url}</body>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
  const base = `http://127.0.0.1:${address.port}`
  const activeTabId = () => appWindow.evaluate(async () => (await (window as unknown as { hronaut: HronautApi }).hronaut.getState()).activeTabId)
  try {
    const ids = await appWindow.evaluate(async (baseUrl) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const left = (await api.newTab({ url: `${baseUrl}/left`, active: true })).activeTabId!
      const right = (await api.newTab({ url: `${baseUrl}/right`, active: true })).activeTabId!
      await api.selectTab(left)
      await api.openSplitView(right)
      return { left, right }
    }, base)
    await expect.poll(() => appWindow.evaluate(async () => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.every(tab => !tab.loading))).toBe(true)
    expect(await activeTabId()).toBe(ids.left)

    // The person touches the right-hand page.
    await electronApp.evaluate(async ({ BrowserWindow, WebContentsView }, url) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL() === url
      )) as Electron.WebContentsView | undefined
      if (!view) throw new Error('The right-hand page is not shown')
      const debuggerSession = view.webContents.debugger
      const attached = !debuggerSession.isAttached()
      if (attached) debuggerSession.attach('1.3')
      try {
        await debuggerSession.sendCommand('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 40, y: 40 }] })
        await debuggerSession.sendCommand('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      } finally {
        if (attached) debuggerSession.detach()
      }
    }, `${base}/right`)

    await expect.poll(activeTabId).toBe(ids.right)
  } finally {
    await closeFixtureServer(server)
  }
})
