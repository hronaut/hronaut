import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { closeFixtureServer, expect, test } from './fixtures.js'

for (const eventKind of ['focus', 'navigation', 'show', 'capture', 'close', 'popup'] as const) {
  test(`preserves native focus during agent ${eventKind}`, async ({ appWindow, electronApp, mcpPort, mcpToken }) => {
    const fixture = createServer((request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end(`<!doctype html><title>Delayed page focus</title><body ${request.url === '/landed' ? 'data-focus-attempted="yes"' : ''}><style>body { margin: 0; min-height: 3000px; background: #00ff00 }</style><main>Ready</main><input id="value">`)
    })
    await new Promise<void>(resolve => fixture.listen(0, '127.0.0.1', resolve))
    const address = fixture.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const origin = `http://127.0.0.1:${address.port}`
    const client = new Client({ name: 'delayed-agent-focus', version: '1' })
    const call = async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as CallToolResult
    let humanWindowId: number | undefined
    try {
      await expect.poll(async () => {
        try { return (await fetch(`http://127.0.0.1:${mcpPort}/healthz`)).ok } catch { return false }
      }).toBe(true)
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${mcpToken}` } }
      }))
      const created = await call('browser_workspaces', { action: 'create', name: 'Delayed focus', storage: 'scratch' })
      expect(created.isError).not.toBe(true)
      const { id: workspaceId } = JSON.parse(created.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { id: string }
      const opened = await call('browser_new_tab', { workspaceId, url: origin })
      expect(opened.isError).not.toBe(true)
      const openedState = JSON.parse(opened.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { tabs: Array<{ id: string; url: string }> }
      const targetTabId = openedState.tabs.find(tab => tab.url.startsWith(origin))?.id
      if (!targetTabId) throw new Error('Missing focus fixture tab')
      let backgroundTabId: string | undefined
      if (eventKind === 'capture') {
        await appWindow.evaluate('window.hronautSettings.setFollowAgentActivity(false)')
        const background = await call('browser_new_tab', { workspaceId, url: `${origin}/background`, active: false })
        expect(background.isError).not.toBe(true)
        const state = JSON.parse(background.content.filter(part => part.type === 'text').map(part => part.text).join('\n')) as { tabs: Array<{ id: string; url: string }> }
        backgroundTabId = state.tabs.find(tab => tab.url.endsWith('/background'))?.id
        expect(backgroundTabId).toBeTruthy()
        expect((await call('browser_evaluate', { workspaceId, tabId: backgroundTabId,
          script: "window.__captureIdentity = 'unchanged'; document.querySelector('input').value = 'unsaved'; scrollTo(0, 400); 'ready'"
        })).isError).not.toBe(true)
      }
      // Ensure close/popups exercise the currently presented tab, regardless
      // of the default follow-agent setting.
      if (eventKind === 'close' || eventKind === 'popup') {
        await appWindow.evaluate(`window.hronaut.selectTab(${JSON.stringify(targetTabId)})`)
      }
      humanWindowId = await electronApp.evaluate(async ({ BrowserWindow }, fullscreen) => {
        const human = new BrowserWindow({ width: 320, height: 200, show: false, fullscreen })
        await human.loadURL('data:text/html,<title>Human foreground</title><input autofocus>')
        human.show(); human.focus()
        return human.id
      }, process.env.HRONAUT_TEST_WAYLAND === '1')
      const humanId = humanWindowId
      if (process.env.HRONAUT_TEST_WAYLAND === '1') {
        await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getBounds().width, humanId)).toBeGreaterThan(1600)
        execFileSync('xdotool', ['mousemove', '960', '540', 'click', '1'])
      }
      await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanId)
      if (process.env.HRONAUT_TEST_WAYLAND === '1') {
        await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.setFullScreen(false), humanId)
        await expect.poll(() => electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.getBounds().width, humanId)).toBeLessThan(400)
        expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanId)
      }
      await electronApp.evaluate(({ BrowserWindow }, id) => {
        const state = globalThis as typeof globalThis & { __qaFocusLosses?: number }
        state.__qaFocusLosses = 0
        BrowserWindow.fromId(id)?.on('blur', () => { state.__qaFocusLosses! += 1 })
      }, humanId)
      await electronApp.evaluate(({ app }) => {
        const state = globalThis as typeof globalThis & { __qaWindowCount?: number; __qaOnWindow?: () => void }
        state.__qaWindowCount = 0
        state.__qaOnWindow = () => { state.__qaWindowCount! += 1 }
        app.on('browser-window-created', state.__qaOnWindow)
      })
      await electronApp.evaluate(({ BrowserWindow }, humanId) => {
        const main = BrowserWindow.getAllWindows().find(window => window.id !== humanId)
        if (!main) throw new Error('Missing main window')
        const state = globalThis as typeof globalThis & { __qaFocusRequests?: number; __qaRaiseRequests?: number; __qaRestoreFocusSpies?: () => void }
        state.__qaFocusRequests = 0
        state.__qaRaiseRequests = 0
        const prototype = Object.getPrototypeOf(main.webContents) as Electron.WebContents
        const focus = prototype.focus
        const showInactive = main.showInactive
        prototype.focus = function () { state.__qaFocusRequests! += 1; return focus.call(this) }
        main.showInactive = function () { state.__qaRaiseRequests! += 1; return showInactive.call(this) }
        state.__qaRestoreFocusSpies = () => { prototype.focus = focus; main.showInactive = showInactive }
      }, humanId)
      const result = eventKind === 'close' ? await call('browser_close_tab', { workspaceId, tabId: targetTabId }) : eventKind === 'popup' ? await call('browser_evaluate', { workspaceId, script: "window.open('/popup'); 'opened'" }) : eventKind === 'capture' ? await call('browser_screenshot', { workspaceId, tabId: backgroundTabId }) : eventKind === 'show' ? await call('browser_show', { workspaceId }) : await call('browser_evaluate', { workspaceId, script: eventKind === 'focus'
        ? "setTimeout(() => { window.focus(); document.body.dataset.focusAttempted = 'yes'; }, 250); 'scheduled'"
        : "setTimeout(() => { location.href = '/landed'; }, 250); 'scheduled'" })
      expect(result.isError, JSON.stringify(result.content.filter(part => part.type === 'text'))).not.toBe(true)
      if (eventKind === 'popup') await expect.poll(() => electronApp.evaluate(({ webContents }, url) =>
        webContents.getAllWebContents().some(contents => contents.getURL() === url), `${origin}/popup`)).toBe(true)
      expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __qaFocusRequests?: number }).__qaFocusRequests)).toBe(0)
      if (eventKind === 'show') expect(await electronApp.evaluate(() =>
        (globalThis as typeof globalThis & { __qaRaiseRequests?: number }).__qaRaiseRequests)).toBe(0)
      if (eventKind === 'capture') {
        expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __qaWindowCount?: number }).__qaWindowCount)).toBe(0)
        const image = result.content.find(part => part.type === 'image')
        expect(image?.type).toBe('image')
        if (image?.type !== 'image') throw new Error('Missing captured pixels')
        const captured = await electronApp.evaluate(({ nativeImage }, data) => {
          const image = nativeImage.createFromBuffer(Buffer.from(data, 'base64'))
          return { size: image.getSize(), pixel: [...image.toBitmap().subarray(0, 4)] }
        }, image.data)
        expect(captured.size.width).toBeGreaterThan(100)
        expect(captured.size.height).toBeGreaterThan(100)
        expect(captured.pixel).toEqual([0, 255, 0, 255])
        expect(await electronApp.evaluate(({ webContents }, expectedUrl) => {
          const page = webContents.getAllWebContents().find(contents => contents.getURL() === expectedUrl)
          return page?.executeJavaScript("({ identity: window.__captureIdentity, value: document.querySelector('input').value, scroll: scrollY })")
        }, `${origin}/background`)).toEqual({ identity: 'unchanged', value: 'unsaved', scroll: 400 })
      }
      if (eventKind === 'focus' || eventKind === 'navigation') await expect.poll(() => electronApp.evaluate(({ webContents }, expectedOrigin) => {
        const page = webContents.getAllWebContents().find(contents => contents.getURL().startsWith(expectedOrigin))
        return page?.executeJavaScript('document.body.dataset.focusAttempted')
      }, origin)).toBe('yes')
      expect(await electronApp.evaluate(() => (globalThis as typeof globalThis & { __qaFocusLosses?: number }).__qaFocusLosses)).toBe(0)
      expect(await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow()?.id)).toBe(humanId)
    } finally {
      await client.close()
      await electronApp.evaluate(({ app }) => {
        const state = globalThis as typeof globalThis & { __qaOnWindow?: () => void; __qaRestoreFocusSpies?: () => void }
        state.__qaRestoreFocusSpies?.()
        delete state.__qaRestoreFocusSpies
        if (state.__qaOnWindow) app.removeListener('browser-window-created', state.__qaOnWindow)
        delete state.__qaOnWindow
      })
      if (humanWindowId !== undefined) await electronApp.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.destroy(), humanWindowId)
      await closeFixtureServer(fixture)
    }
  })
}
