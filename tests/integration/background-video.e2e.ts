import { readFile } from 'node:fs/promises'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi, HronautSettingsApi, HronautShellApi } from '../../src/shared/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { useMcpWorkspace } from '../../scripts/mcp-workspace.js'
import { test, expect, text } from './capability-fixtures.js'

type SleepCaptureGlobal = typeof globalThis & { __sleepCapture?: { held: boolean; restore(): void } }

type TestWindow = Window & { hronaut: HronautApi; hronautSettings: HronautSettingsApi; hronautShell: HronautShellApi }

test('two agents export distinct progressing background tabs while the human keeps a third selected', async ({ capabilities, appWindow, mcpPort, mcpToken }, testInfo) => {
  const { client, tabId, fixtureOrigin } = capabilities
  const other = new Client({ name: 'background-recorder-two', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`), { requestInit: { headers: { authorization: `Bearer ${mcpToken}` } } })
  await other.connect(transport)
  const call = async (owner: Client, id: string, action: string): Promise<BrowserVideoState> => {
    const result = await owner.callTool({ name: 'browser_video', arguments: { tabId: id, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result))
  }
  try {
    const otherWorkspace = await useMcpWorkspace(other, 'Second background recorder', false)
    await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${fixtureOrigin}/background-video?red` } })
    const opened = await other.callTool({ name: 'browser_new_tab', arguments: { url: `${fixtureOrigin}/background-video?blue`, active: false } }) as CallToolResult
    expect(opened.isError, text(opened)).not.toBe(true)
    const secondId = (JSON.parse(text(opened)) as { tabs: { id: string; url: string }[] }).tabs.find(tab => tab.url.includes('/background-video?blue'))!.id
    await other.callTool({ name: 'browser_wait', arguments: { tabId: secondId } })
    const human = await appWindow.evaluate(async url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), `${fixtureOrigin}/?human`)
    const humanId = human.activeTabId
    const selected = () => appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).activeTabId)
    for (const follow of [true, false]) {
      await appWindow.evaluate(value => (window as unknown as TestWindow).hronautSettings.setFollowAgentActivity(value), follow)
      await Promise.all([call(client, tabId, 'start'), call(other, secondId, 'start')])
      await expect.poll(selected).toBe(humanId)
      await expect.poll(async () => (await call(client, tabId, 'get')).frameCount).toBeGreaterThanOrEqual(12)
      await expect.poll(async () => (await call(other, secondId, 'get')).frameCount).toBeGreaterThanOrEqual(12)
      expect(await selected()).toBe(humanId)
      const stopped = await Promise.all([call(client, tabId, 'stop'), call(other, secondId, 'stop')])
      for (const [index, id] of [tabId, secondId].entries()) {
        const output = await call(index ? other : client, id, 'export')
        const data = (await readFile(output.exported!.path)).toString('base64')
        const samples = await appWindow.evaluate(async ({ data, duration }) => {
          const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0))
          const url = URL.createObjectURL(new Blob([bytes], { type: 'video/webm' }))
          const video = document.createElement('video')
          try {
            video.src = url; video.muted = true
            await new Promise<void>((resolve, reject) => { video.onloadeddata = () => resolve(); video.onerror = () => reject(new Error('Decode failed')) })
            const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
            const ctx = canvas.getContext('2d')!
            const samples: number[][] = []
            for (let n = 1; n <= 10; n++) {
              video.currentTime = duration / 1000 * n / 12
              await new Promise<void>(resolve => { video.onseeked = () => resolve() })
              ctx.drawImage(video, 0, 0)
              samples.push([...ctx.getImageData(canvas.width * .25, canvas.height * .7, 1, 1).data, ...ctx.getImageData(canvas.width * .75, canvas.height * .7, 1, 1).data])
            }
            return samples
          } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
        }, { data, duration: stopped[index]!.durationMs })
        for (const pixel of samples) {
          expect(pixel[index ? 2 : 0]).toBeGreaterThan(180)
          expect(pixel[index ? 0 : 2]).toBeLessThan(60)
        }
        const distinctAnimationLevels = new Set(samples.map(pixel => Math.round(pixel[4]! / 16))).size
        expect(distinctAnimationLevels).toBeGreaterThan(2)
        console.info('Background video decoded QA', JSON.stringify({ follow, source: index ? 'blue' : 'red', sampleCount: samples.length, distinctAnimationLevels }))
        await testInfo.attach(`decoded-${follow}-${index}`, { body: JSON.stringify(samples), contentType: 'application/json' })
      }
      expect(await selected()).toBe(humanId)
      await Promise.all([call(client, tabId, 'clear'), call(other, secondId, 'clear')])
    }
    await Promise.all([call(client, tabId, 'start'), call(other, secondId, 'start')])
    await other.callTool({ name: 'browser_workspaces', arguments: { action: 'release-ownership', workspaceId: otherWorkspace } })
    await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as TestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).status, secondId)).toBe('paused')
    await other.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId: otherWorkspace } })
    await call(other, secondId, 'resume')
    // SDK close() alone leaves the HTTP session alive. DELETE is the observable
    // protocol disconnect and revokes its workspace ownership on the server.
    await transport.terminateSession()
    await other.close()
    await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as TestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).status, secondId)).toBe('paused')
    const before = (await call(client, tabId, 'get')).frameCount
    await expect.poll(async () => (await call(client, tabId, 'get')).frameCount).toBeGreaterThan(before)
    const denied = await client.callTool({ name: 'browser_video', arguments: { tabId: secondId, action: 'get' } }) as CallToolResult
    expect(denied.isError).toBe(true)
    await appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.manageVideo({ tabId: id, action: 'resume' }), secondId)
    await appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.closeTab(id), secondId)
    const afterClose = (await call(client, tabId, 'get')).frameCount
    await expect.poll(async () => (await call(client, tabId, 'get')).frameCount).toBeGreaterThan(afterClose)
    await call(client, tabId, 'clear')
    expect(await selected()).toBe(humanId)
  } finally { await other.close().catch(() => undefined) }
})


test('background capture pauses for hidden chrome, hidden window and suspend without silently resuming', async ({ capabilities, appWindow, electronApp }, testInfo) => {
  const { tabId, fixtureOrigin, fixtureUrl } = capabilities
  const humanId = (await appWindow.evaluate(url => (window as unknown as TestWindow).hronaut.newTab({ url, active: true }), `${fixtureOrigin}/?human`)).activeTabId
  const video = (action: 'start' | 'get' | 'resume' | 'clear') => appWindow.evaluate(({ id, action }) => (window as unknown as TestWindow).hronaut.manageVideo({ tabId: id, action }), { id: tabId, action })
  const windowHandle = await electronApp.browserWindow(appWindow)
  try {
    await video('start')
    await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThan(1)
    await electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(candidate => candidate.getURL() === url)!
      const original = page.capturePage.bind(page)
      let release!: () => void
      const barrier = new Promise<void>(resolve => { release = resolve })
      const gate = { held: false, restore: () => { page.capturePage = original; release() } }
      ;(globalThis as SleepCaptureGlobal).__sleepCapture = gate
      page.capturePage = async (...args: Parameters<Electron.WebContents['capturePage']>) => {
        if (!args[1]?.stayHidden || !args[1]?.stayAwake) return original(...args)
        page.capturePage = original
        const image = await original(...args)
        gate.held = true
        await barrier
        return image
      }
    }, fixtureUrl)
    await expect.poll(() => electronApp.evaluate(() => (globalThis as SleepCaptureGlobal).__sleepCapture?.held)).toBe(true)
    await expect(appWindow.evaluate(id => (window as unknown as TestWindow).hronaut.setTabSleeping(id, true), tabId)).rejects.toThrow('recording video')
    await electronApp.evaluate(() => (globalThis as SleepCaptureGlobal).__sleepCapture?.restore())
    await appWindow.evaluate(() => (window as unknown as TestWindow).hronautShell.setBrowserContentOccluded(true))
    await expect.poll(async () => (await video('get')).status).toBe('paused')
    await appWindow.evaluate(() => (window as unknown as TestWindow).hronautShell.setBrowserContentOccluded(false))
    expect((await video('get')).status).toBe('paused')
    await video('resume')
    await windowHandle.evaluate(window => window.hide())
    await expect.poll(async () => (await video('get')).status).toBe('paused')
    await windowHandle.evaluate(window => window.showInactive())
    expect((await video('get')).status).toBe('paused')
    await video('resume')
    const nativeMinimized = await windowHandle.evaluate(async window => {
      window.minimize()
      const deadline = Date.now() + 1500
      while (!window.isMinimized() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25))
      return window.isMinimized()
    })
    if (!nativeMinimized) {
      // Xvfb has no window manager. Exercise the native-state guard separately;
      // the attached receipt must not claim a real minimize transition occurred.
      await windowHandle.evaluate(window => {
        const original = window.isMinimized.bind(window)
        Object.defineProperty(window, '__restoreVideoMinimize', { configurable: true, value: () => {
          Object.defineProperty(window, 'isMinimized', { configurable: true, value: original })
        } })
        Object.defineProperty(window, 'isMinimized', { configurable: true, value: () => true })
      })
    }
    await expect.poll(async () => (await video('get')).status).toBe('paused')
    await windowHandle.evaluate(window => {
      const probe = window as typeof window & { __restoreVideoMinimize?: () => void }
      probe.__restoreVideoMinimize?.(); delete probe.__restoreVideoMinimize
      window.restore(); window.showInactive()
    })
    console.info('Background video window QA', JSON.stringify({ nativeMinimized, minimizedStateGuard: true, realHiddenWindow: true, physicalSystemSleep: false }))
    await testInfo.attach('window-power-scope', { body: JSON.stringify({ nativeMinimized, minimizedStateGuard: true, realHiddenWindow: true, physicalSystemSleep: false }), contentType: 'application/json' })
    expect((await video('get')).status).toBe('paused')
    await video('resume')
    // Exercise the real main-process suspend listener without sleeping the CI host.
    await electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('suspend'))
    await expect.poll(async () => (await video('get')).status).toBe('paused')
    expect((await video('get')).notice).toContain('system sleep')
    await electronApp.evaluate(({ powerMonitor }) => powerMonitor.emit('resume'))
    expect((await video('get')).status).toBe('paused')
    expect(await appWindow.evaluate(async () => (await (window as unknown as TestWindow).hronaut.getState()).activeTabId)).toBe(humanId)
  } finally {
    await electronApp.evaluate(() => {
      const probe = globalThis as SleepCaptureGlobal
      probe.__sleepCapture?.restore()
      delete probe.__sleepCapture
    })
    await appWindow.evaluate(() => (window as unknown as TestWindow).hronautShell.setBrowserContentOccluded(false))
    await windowHandle.evaluate(window => {
      const probe = window as typeof window & { __restoreVideoMinimize?: () => void }
      probe.__restoreVideoMinimize?.(); delete probe.__restoreVideoMinimize
      window.restore(); window.showInactive()
    })
    await video('clear')
  }
})
