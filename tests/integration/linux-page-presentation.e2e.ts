import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { integrationMcpPort } from './port-allocation.js'

// Do not attach Playwright to Chromium here: its focus emulation forces pages
// visible and masks the Linux native-view failure. Inspect only Electron's main
// process, leaving renderer visibility and desktop composition untouched.
// The test intentionally requests no browser fixture (see above).
// eslint-disable-next-line no-empty-pattern
test('recovers a presented native view left hidden by Chromium', async ({}, testInfo) => {
  test.skip(process.platform !== 'linux')
  const profile = await mkdtemp(join(tmpdir(), 'hronaut-presentation-'))
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const executable = process.env.HRONAUT_TEST_EXECUTABLE ?? join(root, 'node_modules/electron/dist/electron')
  const mcpPort = integrationMcpPort(process.env.HRONAUT_TEST_SHARD, testInfo.workerIndex)
  const child = spawn(executable, [
    ...(process.env.HRONAUT_TEST_EXECUTABLE ? [] : ['.']), '--inspect=0',
    ...(process.env.CI ? ['--no-sandbox'] : [])
  ], { detached: true, cwd: root, env: { ...process.env, HRONAUT_USER_DATA_DIR: profile, HRONAUT_MCP_PORT: String(mcpPort) }, stdio: ['ignore', 'ignore', 'pipe'] })
  let socket: WebSocket | undefined
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const exited = once(child, 'exit')
  try {
    await expect.poll(() => stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)?.[1]).toBeTruthy()
    // The inspector opens before Electron has initialized its native modules.
    await expect.poll(async () => {
      try { await fetch(`http://127.0.0.1:${mcpPort}/healthz`); return true } catch { return false }
    }).toBe(true)
    socket = new WebSocket(stderr.match(/Debugger listening on (ws:\/\/[^\s]+)/)![1]!)
    await new Promise<void>((resolve, reject) => {
      socket!.onopen = () => resolve()
      socket!.onerror = () => reject(new Error('Inspector connection failed'))
    })
    let sequence = 0
    const pending = new Map<number, (message: { result?: { result?: { value?: unknown }; exceptionDetails?: unknown }; error?: unknown }) => void>()
    socket.onmessage = event => {
      const message = JSON.parse(String(event.data))
      pending.get(message.id)?.(message)
      pending.delete(message.id)
    }
    const evaluate = (body: string): Promise<unknown> => new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, message => {
        if (message.error || message.result?.exceptionDetails) reject(new Error(JSON.stringify(message)))
        else resolve(message.result?.result?.value)
      })
      socket!.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
        expression: `(async () => {
          const { BrowserWindow, WebContentsView, desktopCapturer, screen } = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
          const window = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/out/renderer/index.html'));
          const view = window?.contentView.children.find(v => v instanceof WebContentsView && v.webContents.getURL().startsWith('data:text/html,'));
          ${body}
        })()`, awaitPromise: true, returnByValue: true
      } }))
    })
    await expect.poll(() => evaluate('return window?.isVisible()')).toBe(true)
    const url = 'data:text/html,' + encodeURIComponent('<!doctype html><title>Native presentation</title><style>html,body{margin:0}main{height:100vh;background:rgb(24,160,72)}</style><main>Native presentation</main>')
    await evaluate(`await window.webContents.executeJavaScript(${JSON.stringify(`window.hronaut.newTab({url:${JSON.stringify(url)},active:true})`)}); window.setAlwaysOnTop(true); window.show();`)
    await expect.poll(() => evaluate('return view && !view.webContents.isLoading()')).toBe(true)
    await expect.poll(() => evaluate("return view.webContents.executeJavaScript('document.visibilityState')")).toBe('visible')

    // Freeze/thaw drives Chromium's real WasHidden path without hiding its
    // Electron View. Thaw resumes scripts but does not call WasShown, producing
    // the same visible-native-view/hidden-document mismatch observed live.
    await evaluate(`
      const debuggerSession = view.webContents.debugger;
      const attached = debuggerSession.isAttached();
      if (!attached) debuggerSession.attach('1.3');
      try {
        await debuggerSession.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
        await debuggerSession.sendCommand('Page.setWebLifecycleState', { state: 'active' });
      } finally { if (!attached) debuggerSession.detach(); }
    `)
    await expect.poll(() => evaluate("return {native: view.getVisible(), page: await view.webContents.executeJavaScript('document.visibilityState')}")).toEqual({ native: true, page: 'hidden' })
    await evaluate(`
      await view.webContents.executeJavaScript("window.presentationIdentity = 'preserved'; document.querySelector('main').style.background = 'rgb(32,96,224)'");
      window.webContents.focus();
      window.emit('resize');
    `)
    await expect.poll(() => evaluate("return view.webContents.executeJavaScript('document.visibilityState')")).toBe('visible')
    await expect.poll(() => evaluate(`
      const host = window.getContentBounds();
      const bounds = view.getBounds();
      const display = screen.getDisplayMatching(host);
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: display.size });
      const image = sources.find(source => source.display_id === String(display.id)).thumbnail;
      const x = Math.floor(host.x + bounds.x + bounds.width / 2 - display.bounds.x);
      const y = Math.floor(host.y + bounds.y + bounds.height / 2 - display.bounds.y);
      const [blue, green, red] = image.crop({ x, y, width: 1, height: 1 }).toBitmap();
      return blue > 170 && green < 140 && red < 100;
    `)).toBe(true)
    expect(await evaluate(`return {
      identity: await view.webContents.executeJavaScript('window.presentationIdentity'),
      shellFocused: window.webContents.isFocused(),
      throttled: view.webContents.getBackgroundThrottling()
    }`)).toEqual({ identity: 'preserved', shellFocused: true, throttled: true })
    // A deliberately hidden host must stay hidden through layout reconciliation.
    await evaluate("window.hide(); window.emit('resize')")
    await expect.poll(() => evaluate("return view.webContents.executeJavaScript('document.visibilityState')")).toBe('hidden')
    expect(await evaluate('return window.isVisible()')).toBe(false)
    await testInfo.attach('runtime', { body: JSON.stringify(await evaluate('return process.versions')), contentType: 'application/json' })
  } finally {
    if (testInfo.status !== testInfo.expectedStatus) console.log(stderr)
    socket?.close()
    if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, 'SIGKILL')
    await exited
    await rm(profile, { recursive: true, force: true })
  }
})
