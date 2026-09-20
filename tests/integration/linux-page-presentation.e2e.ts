import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import { integrationMcpPort } from './port-allocation.js'

interface PageLifecycleClockProbe {
  interval: number
  raf: number
  worker: number
  cssTime: number
  webAnimationTime: number
}

// Do not attach Playwright to Chromium here: its focus emulation forces pages
// visible and masks the Linux native-view failure. Inspect only Electron's main
// process, leaving renderer visibility and desktop composition untouched.
// The test intentionally requests no browser fixture (see above).
// eslint-disable-next-line no-empty-pattern
test('recovers an idle presented native view and preserves an explicit page hold', async ({}, testInfo) => {
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
          const { BrowserWindow, WebContentsView, desktopCapturer, screen, webContents } = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
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
    expect(await evaluate('return view.getVisible()')).toBe(true)
    await evaluate(`
      await view.webContents.executeJavaScript("window.presentationIdentity = 'preserved'; document.querySelector('main').style.background = 'rgb(32,96,224)'");
      window.webContents.focus();
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
    // Repair also runs while a different native window owns keyboard focus.
    const humanWindowId = await evaluate(`
      const human = new BrowserWindow({ width: 160, height: 100, show: false });
      await human.loadURL('data:text/html,<title>Human focus owner</title>');
      human.show(); human.focus();
      return human.id;
    `)
    await expect.poll(() => evaluate('return BrowserWindow.getFocusedWindow()?.id')).toBe(humanWindowId)
    await evaluate(`
      window.presentationUnexpectedFocus = 0;
      window.presentationFocusListener = () => { window.presentationUnexpectedFocus += 1; };
      window.on('focus', window.presentationFocusListener);
      const debuggerSession = view.webContents.debugger;
      const attached = debuggerSession.isAttached();
      if (!attached) debuggerSession.attach('1.3');
      try {
        await debuggerSession.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
        await debuggerSession.sendCommand('Page.setWebLifecycleState', { state: 'active' });
      } finally { if (!attached) debuggerSession.detach(); }
    `)
    await expect.poll(() => evaluate("return view.webContents.executeJavaScript('document.visibilityState')")).toBe('visible')
    expect(await evaluate('return {owner: BrowserWindow.getFocusedWindow()?.id, activations: window.presentationUnexpectedFocus}'))
      .toEqual({ owner: humanWindowId, activations: 0 })
    await evaluate(`window.removeListener('focus', window.presentationFocusListener); BrowserWindow.fromId(${humanWindowId})?.destroy();`)
    const lifecycleProbe = await evaluate(`
      await view.webContents.executeJavaScript(${JSON.stringify(`(() => {
        const style = document.createElement('style');
        style.textContent = '@keyframes hronautProbe { to { transform: translateX(100px) } } #probe-css { animation: hronautProbe 4s linear infinite }';
        document.head.append(style);
        const css = document.createElement('div'); css.id = 'probe-css'; document.body.append(css);
        const waapi = document.createElement('div'); document.body.append(waapi);
        const webAnimation = waapi.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 4000, iterations: Infinity });
        const counters = { interval: 0, raf: 0, worker: 0 };
        setInterval(() => counters.interval += 1, 20);
        const frame = () => { counters.raf += 1; requestAnimationFrame(frame); }; requestAnimationFrame(frame);
        const worker = new Worker(URL.createObjectURL(new Blob(['let tick=0;setInterval(()=>postMessage(++tick),20)'])));
        worker.onmessage = () => counters.worker += 1;
        window.readLifecycleProbe = () => ({
          ...counters,
          cssTime: Number(css.getAnimations()[0]?.currentTime || 0),
          webAnimationTime: Number(webAnimation.currentTime || 0)
        });
      })()`)});
      const state = await window.webContents.executeJavaScript('window.hronaut.getState()');
      const tab = state.tabs.find(candidate => candidate.url.startsWith('data:text/html,'));
      const environment = ${JSON.stringify({
        network: 'none', cacheDisabled: false, bypassServiceWorker: false, dataSaver: 'auto',
        cpuThrottlingRate: 1, animationPlaybackRate: 0.25, colorScheme: 'auto', reducedMotion: 'auto',
        mediaType: 'auto', forcedColors: 'auto', contrast: 'auto', reducedTransparency: 'auto',
        visionDeficiency: 'none', userAgent: '', locale: '', timezoneId: '', javaScriptDisabled: false,
        geolocation: null, renderingDebug: {
          paintFlashing: false, layoutShiftRegions: false, layerBorders: false, fpsCounter: false, scrollBottlenecks: false
        }
      })};
      await window.webContents.executeJavaScript(
        'window.hronaut.setTabEnvironment(' + JSON.stringify(tab.id) + ',' + JSON.stringify(environment) + ')'
      );
      const otherUrl = 'data:text/html,' + encodeURIComponent('<title>Other lifecycle page</title><script>window.otherTicks=0;setInterval(()=>window.otherTicks+=1,20)<\\/script>');
      await window.webContents.executeJavaScript('window.hronaut.newTab({url:' + JSON.stringify(otherUrl) + ',active:false})');
      let otherContents;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        otherContents = webContents.getAllWebContents().find(candidate => candidate.getURL() === otherUrl);
        if (otherContents && !otherContents.isLoading()) break;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      otherContents.setBackgroundThrottling(false);
      await new Promise(resolve => setTimeout(resolve, 220));
      const before = await view.webContents.executeJavaScript('readLifecycleProbe()');
      const selectionBefore = (await window.webContents.executeJavaScript('window.hronaut.getState()')).activeTabId;
      await window.webContents.executeJavaScript('Promise.all([window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"frozen"),window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"frozen")])');
      await new Promise(resolve => setTimeout(resolve, 500));
      const frozenState = await window.webContents.executeJavaScript('window.hronaut.getState()');
      const otherTicks = await otherContents.executeJavaScript('window.otherTicks');
      await window.webContents.executeJavaScript('Promise.all([window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"active"),window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"active")])');
      const after = await view.webContents.executeJavaScript('readLifecycleProbe()');
      await new Promise(resolve => setTimeout(resolve, 220));
      const resumed = await view.webContents.executeJavaScript('readLifecycleProbe()');
      const finalState = await window.webContents.executeJavaScript('window.hronaut.getState()');
      const debuggerSession = view.webContents.debugger;
      const originalSendCommand = debuggerSession.sendCommand.bind(debuggerSession);
      let failedLifecycleDispatches = 0;
      debuggerSession.sendCommand = async (method, params) => {
        if (method === 'Page.setWebLifecycleState' && params?.state === 'frozen') {
          failedLifecycleDispatches += 1;
          throw new Error('simulated debugger connection loss after dispatch');
        }
        return originalSendCommand(method, params);
      };
      let unknownState;
      let repeatedUnknownState;
      try {
        unknownState = await window.webContents.executeJavaScript('window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"frozen")');
        repeatedUnknownState = await window.webContents.executeJavaScript('window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"frozen")');
      } finally {
        debuggerSession.sendCommand = originalSendCommand;
      }
      const recoveredState = await window.webContents.executeJavaScript('window.hronaut.setTabPageLifecycle(' + JSON.stringify(tab.id) + ',"active")');
      return {
        before, after, resumed, otherTicks, selectionBefore,
        frozenState: frozenState.tabs.find(candidate => candidate.id === tab.id),
        finalState: finalState.tabs.find(candidate => candidate.id === tab.id),
        finalSelection: finalState.activeTabId,
        failedLifecycleDispatches,
        unknownState: unknownState.tabs.find(candidate => candidate.id === tab.id),
        repeatedUnknownState: repeatedUnknownState.tabs.find(candidate => candidate.id === tab.id),
        recoveredState: recoveredState.tabs.find(candidate => candidate.id === tab.id)
      };
    `) as {
      before: PageLifecycleClockProbe
      after: PageLifecycleClockProbe
      resumed: PageLifecycleClockProbe
      otherTicks: number
      selectionBefore: string
      finalSelection: string
      failedLifecycleDispatches: number
      frozenState: { pageLifecycleState: string; sleeping: boolean; emulation?: { animationPlaybackRate?: number } }
      finalState: { pageLifecycleState: string; sleeping: boolean; emulation?: { animationPlaybackRate?: number } }
      unknownState: { pageLifecycleState: string }
      repeatedUnknownState: { pageLifecycleState: string }
      recoveredState: { pageLifecycleState: string; emulation?: { animationPlaybackRate?: number } }
    }
    expect(lifecycleProbe.frozenState.pageLifecycleState).toBe('frozen')
    expect(lifecycleProbe.finalState).toMatchObject({ pageLifecycleState: 'active', sleeping: false })
    expect(lifecycleProbe.finalState.emulation?.animationPlaybackRate).toBe(0.25)
    expect(lifecycleProbe.finalSelection).toBe(lifecycleProbe.selectionBefore)
    expect(lifecycleProbe.otherTicks).toBeGreaterThan(10)
    // This sample includes the asynchronous shell-to-main handoff before the
    // freeze takes effect. Leave room for a busy CI worker while still staying
    // well below the ~25 timer/frame ticks and 125ms of animation time that a
    // live page would accumulate during the 500ms hold.
    expect(lifecycleProbe.after.interval - lifecycleProbe.before.interval).toBeLessThanOrEqual(10)
    expect(lifecycleProbe.after.raf - lifecycleProbe.before.raf).toBeLessThanOrEqual(10)
    expect(lifecycleProbe.after.cssTime - lifecycleProbe.before.cssTime).toBeLessThan(50)
    expect(lifecycleProbe.after.webAnimationTime - lifecycleProbe.before.webAnimationTime).toBeLessThan(50)
    expect(lifecycleProbe.resumed.interval - lifecycleProbe.after.interval).toBeGreaterThan(4)
    expect(lifecycleProbe.resumed.raf - lifecycleProbe.after.raf).toBeGreaterThan(4)
    expect(lifecycleProbe.resumed.cssTime - lifecycleProbe.after.cssTime).toBeGreaterThan(20)
    expect(lifecycleProbe.resumed.webAnimationTime - lifecycleProbe.after.webAnimationTime).toBeGreaterThan(20)
    expect(lifecycleProbe.unknownState.pageLifecycleState).toBe('unknown')
    expect(lifecycleProbe.repeatedUnknownState.pageLifecycleState).toBe('unknown')
    expect(lifecycleProbe.failedLifecycleDispatches).toBe(1)
    expect(lifecycleProbe.recoveredState).toMatchObject({
      pageLifecycleState: 'active',
      emulation: { animationPlaybackRate: 0.25 }
    })
    await testInfo.attach('page-lifecycle-support-matrix', {
      body: JSON.stringify({
        runtime: { electron: '44.3.0', chromium: '152.0.7977.78' }, frozenForMs: 500,
        deltasDuringHold: Object.fromEntries((Object.keys(lifecycleProbe.before) as Array<keyof PageLifecycleClockProbe>).map(key => [
          key, lifecycleProbe.after[key]! - lifecycleProbe.before[key]!
        ])),
        anotherTabTicks: lifecycleProbe.otherTicks,
        caveat: 'Dedicated workers are measured but not guaranteed to freeze. Media, network delivery, service workers, and cross-origin frames are outside the asserted main-document clock contract.'
      }, null, 2),
      contentType: 'application/json'
    })
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
