import { createServer } from 'node:http'
import { closeFixtureServer, expect, test } from './fixtures.js'

type SplitState = { activeTabId: string | null, splitView?: { firstTabId: string, secondTabId: string }, tabs: Array<{ id: string, url: string }> }

// Clicking either page of a split view makes it the active pane, but not while the person's input to it was locked:
// the click never reached it, so the address bar and its Unlock control stayed on the other pane.
test('a click on a locked split pane makes it the active pane, while the page still gets none of it', async ({ appWindow, electronApp }) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end(`<!doctype html><title>${request.url!.slice(1)}</title><body style="height:100vh">
      <script>window.presses = 0; addEventListener('pointerdown', () => { window.presses += 1 })</script>`)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  const state = () => appWindow.evaluate('window.hronaut.getState()') as Promise<SplitState>
  const idOf = async (path: string) => (await state()).tabs.find(tab => tab.url === `${origin}/${path}`)!.id
  // The person's press in the page, as Electron sends it to the page in view.
  const press = (path: string, kind: 'mouse' | 'context') => electronApp.evaluate(({ webContents }, { url, kind }) => {
    const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)
    if (!page) throw new Error(`${url} was not found`)
    const point = { x: 40, y: 40 }
    const button = kind === 'context' ? 'right' : 'left'
    page.sendInputEvent({ type: 'mouseDown', button, clickCount: 1, ...point })
    page.sendInputEvent({ type: 'mouseUp', button, clickCount: 1, ...point })
  }, { url: `${origin}/${path}`, kind })
  const presses = (path: string) => electronApp.evaluate(({ webContents }, url) => (
    webContents.getAllWebContents().find(contents => contents.getURL() === url)!.executeJavaScript('window.presses') as Promise<number>
  ), `${origin}/${path}`)
  try {
    const created = await appWindow.evaluate(`window.hronaut.createWorkspace({ name: 'Locked split', storage: 'scratch' })`) as { mcpTabGroups: Array<{ id: string, name: string }> }
    const workspace = created.mcpTabGroups.find(group => group.name === 'Locked split')!.id
    for (const path of ['left', 'right']) {
      await appWindow.evaluate(`window.hronaut.newTab({ url: ${JSON.stringify(`${origin}/${path}`)}, mcpGroupId: ${JSON.stringify(workspace)}, active: true })`)
      await expect.poll(() => electronApp.evaluate(({ webContents }, url) => (
        webContents.getAllWebContents().find(contents => contents.getURL() === url)?.getTitle()
      ), `${origin}/${path}`)).toBe(path)
    }
    const left = await idOf('left')
    const right = await idOf('right')
    await appWindow.evaluate(`window.hronaut.openSplitView(${JSON.stringify(left)})`)
    await expect.poll(async () => Boolean((await state()).splitView)).toBe(true)
    await expect.poll(async () => (await state()).activeTabId).toBe(right)

    // Unlocked, a press on the other pane makes it active, as before.
    await press('left', 'mouse')
    await expect.poll(async () => (await state()).activeTabId).toBe(left)

    // Locked, a press and a right-click still choose the pane, and the page hears neither.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(right)}, true)`)
    const before = await presses('right')
    await press('right', 'mouse')
    await expect.poll(async () => (await state()).activeTabId).toBe(right)
    await press('left', 'mouse')
    await expect.poll(async () => (await state()).activeTabId).toBe(left)
    await press('right', 'context')
    await expect.poll(async () => (await state()).activeTabId).toBe(right)
    expect(await presses('right')).toBe(before)

    // Under the lock on every tab too.
    await appWindow.evaluate(`window.hronaut.setTabHumanInteractionLocked(${JSON.stringify(right)}, false)`)
    await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(true)')
    const leftBefore = await presses('left')
    await press('left', 'mouse')
    await expect.poll(async () => (await state()).activeTabId).toBe(left)
    expect(await presses('left')).toBe(leftBefore)
  } finally {
    await appWindow.evaluate('window.hronaut.setAllHumanInteractionLocked(false)').catch(() => undefined)
    await closeFixtureServer(server)
  }
})
