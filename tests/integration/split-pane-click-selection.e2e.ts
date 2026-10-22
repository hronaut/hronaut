import { createServer, type ServerResponse } from 'node:http'
import type { HronautApi } from '../../src/shared/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

// The person picked a sleeping tab and, while it woke, clicked into the other pane of their split view. Once the
// sleeping tab woke it still replaced the split view, although clicking that pane's marked tab instead cancelled it.

test('keeps the split view when the person clicks its other pane while a sleeping tab they picked wakes', async ({ appWindow, electronApp }) => {
  let holdSlow = false
  const heldSlow: ServerResponse[] = []
  let slowRequests = 0
  const server = createServer((request, response) => {
    if (request.url === '/slow' && holdSlow) {
      slowRequests += 1
      heldSlow.push(response)
      return
    }
    response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
    response.end(`<!doctype html><title>${request.url}</title><body style="margin:0;min-height:100vh">${request.url}</body>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture server has no port')
  const base = `http://127.0.0.1:${address.port}`
  const shown = () => appWindow.evaluate(async () => {
    const state = await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    return { activeTabId: state.activeTabId, splitView: state.splitView }
  })
  try {
    const ids = await appWindow.evaluate(async (baseUrl) => {
      const api = (window as unknown as { hronaut: HronautApi }).hronaut
      const left = (await api.newTab({ url: `${baseUrl}/left`, active: true })).activeTabId!
      const right = (await api.newTab({ url: `${baseUrl}/right`, active: true })).activeTabId!
      const slow = (await api.newTab({ url: `${baseUrl}/slow`, active: true })).activeTabId!
      await api.selectTab(left)
      await api.openSplitView(right)
      return { left, right, slow }
    }, base)
    await expect.poll(() => appWindow.evaluate(async () => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.every(tab => !tab.loading))).toBe(true)
    await appWindow.evaluate((id) => (window as unknown as { hronaut: HronautApi }).hronaut.setTabSleeping(id, true), ids.slow)
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.sleeping, ids.slow)).toBe(true)
    const split = (await shown()).splitView
    expect(split).toMatchObject({ firstTabId: ids.left, secondTabId: ids.right })

    // The person picks the sleeping tab, whose site takes a while to answer.
    holdSlow = true
    await appWindow.evaluate((id) => {
      const state = window as unknown as { hronaut: HronautApi; __qaSelecting?: Promise<unknown> }
      state.__qaSelecting = state.hronaut.selectTab(id)
    }, ids.slow)
    await expect.poll(() => slowRequests).toBeGreaterThan(0)

    // Meanwhile they click into the right-hand page, which makes it the active pane.
    await electronApp.evaluate(({ BrowserWindow, WebContentsView }, url) => {
      const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((candidate) => (
        candidate instanceof WebContentsView && candidate.webContents.getURL() === url
      )) as Electron.WebContentsView | undefined
      if (!view) throw new Error('The right-hand page is not shown')
      view.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 40, y: 40 })
      view.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 40, y: 40 })
    }, `${base}/right`)
    await expect.poll(async () => (await shown()).activeTabId).toBe(ids.right)

    // The sleeping tab finishes waking.
    holdSlow = false
    for (const response of heldSlow.splice(0)) {
      response.writeHead(200, { 'content-type': 'text/html', 'cache-control': 'no-store' })
      response.end('<!doctype html><title>/slow</title>/slow')
    }
    await appWindow.evaluate(() => (window as unknown as { __qaSelecting?: Promise<unknown> }).__qaSelecting)
    await expect.poll(() => appWindow.evaluate(async (id) => (
      await (window as unknown as { hronaut: HronautApi }).hronaut.getState()
    ).tabs.find(tab => tab.id === id)?.sleeping, ids.slow)).toBe(false)

    expect(await shown()).toEqual({ activeTabId: ids.right, splitView: split })
  } finally {
    holdSlow = false
    for (const response of heldSlow.splice(0)) response.end()
    await closeFixtureServer(server)
  }
})
