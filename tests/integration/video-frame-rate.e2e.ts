import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { HronautApi } from '../../src/shared/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { videoJpegDimensions } from '../../src/main/browser/video-inspection-frames.js'
import { test, expect, text } from './capability-fixtures.js'

type ApiWindow = Window & { hronaut: HronautApi }
import { waitForSettledPageBounds } from './settled-page-bounds.js'

async function animate(electronApp: Parameters<typeof waitForSettledPageBounds>[0], url: string, running: boolean): Promise<void> {
  await electronApp.evaluate(async ({ webContents }, { url, running }) => webContents.getAllWebContents().find(p => p.getURL() === url)!.executeJavaScript(running
    ? "document.body.innerHTML='<canvas id=c width=320 height=180></canvas>';window.spin=true;(function f(t){if(!window.spin)return;const x=document.getElementById('c').getContext('2d');"
      + "x.fillStyle='#'+(Math.floor(t)%4096).toString(16).padStart(3,'0');x.fillRect(0,0,320,180);requestAnimationFrame(f)})(0);void 0"
    : 'window.spin=false;void 0'), { url, running })
}

test('a video of an animating page keeps 30 samples a second from page paints, beside a frame stream', async ({ capabilities, electronApp }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  await animate(electronApp, fixtureUrl, true)
  const video = async (action: string): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  const streamCall = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'browser_frame_stream', arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return result
  }
  const stream = async (args: Record<string, unknown>) => JSON.parse(text(await streamCall(args))) as { status: string; cursor: number }
  try {
    await stream({ action: 'start', maxWidth: 320, maxHeight: 180, quality: 50 })
    await video('start')
    await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(1)
    const first = await video('get')
    await expect.poll(async () => (await video('get')).durationMs, { timeout: 10_000 }).toBeGreaterThanOrEqual(2000)
    // While the recording runs, the page's screencast is at its 1280 x 720; the stream still returns its own size.
    const during = await streamCall({ action: 'read', maxFrames: 2, waitMs: 2000 })
    const sizes = during.content.filter(item => item.type === 'image').map(item => videoJpegDimensions(Buffer.from((item as { data: string }).data, 'base64')))
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) expect(size.width <= 320 && size.height <= 180, JSON.stringify(size)).toBe(true)
    const stopped = await video('stop')
    await testInfo.attach('video-frame-rate', { body: JSON.stringify({ first, stopped, sizes }), contentType: 'application/json' })
    // The old capture copied the page every 83 ms plus its own ~30 ms, about 9 frames a second.
    expect(stopped.frameCount * 1000 / stopped.durationMs).toBeGreaterThanOrEqual(24)
    expect(stopped.width).toBeGreaterThan(0)
    // Repeats share bytes, so the bytes show the page's own new frames: well over ten a second of them.
    expect(stopped.bytes).toBeGreaterThan(first.bytes * 10 * stopped.durationMs / 1000)
    // The frame stream shares the page's screencast and keeps running after the recording stops.
    const before = await stream({ action: 'read', waitMs: 0 })
    const after = await stream({ action: 'read', after: before.cursor, waitMs: 2000 })
    expect(after.status).toBe('FRAMES')
    await stream({ action: 'stop' })
    await video('clear')
  } finally {
    await animate(electronApp, fixtureUrl, false)
  }
})

test('a video of a still page keeps its time by repeating the last frame without its bytes', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  // The fixture page runs a CSS animation; this page draws nothing new once shown.
  await electronApp.evaluate(async ({ webContents }, url) => webContents.getAllWebContents().find(p => p.getURL() === url)!
    .executeJavaScript("document.body.innerHTML='<h1>Still</h1>';void 0"), fixtureUrl)
  const video = async (action: string): Promise<BrowserVideoState> => JSON.parse(text(await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult)) as BrowserVideoState
  await video('start')
  await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(2)
  const first = await video('get')
  await expect.poll(async () => (await video('get')).durationMs, { timeout: 10_000 }).toBeGreaterThanOrEqual(first.durationMs + 1500)
  const stopped = await video('stop')
  expect(stopped.status).toBe('stopped')
  expect(stopped.notice).toBeUndefined()
  expect(stopped.frameCount).toBeGreaterThan(first.frameCount + 30)
  expect(stopped.bytes).toBeLessThan(first.bytes * 3)
  await video('clear')
})

test('a video keeps recording, by copying the page, while its tab is in the background or its Developer Tools are open', async ({ capabilities, electronApp, appWindow }, testInfo) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  await animate(electronApp, fixtureUrl, true)
  const video = async (action: string): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  const grows = async (label: string, from: BrowserVideoState): Promise<BrowserVideoState> => {
    await expect.poll(async () => (await video('get')).durationMs, { timeout: 10_000, message: label }).toBeGreaterThanOrEqual(from.durationMs + 1200)
    const now = await video('get')
    expect(now, label).toMatchObject({ status: 'recording' })
    expect(now.notice, label).toBeUndefined()
    expect(now.bytes, label).toBeGreaterThan(from.bytes)
    return now
  }
  let other: string | undefined
  try {
    await video('start')
    await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(1)
    const drawn = await grows('drawn', await video('get'))
    other = await appWindow.evaluate(async () => (await (window as unknown as ApiWindow).hronaut.newTab()).activeTabId ?? undefined)
    expect(other).not.toBe(tabId)
    const background = await grows('background', drawn)
    await appWindow.evaluate(id => (window as unknown as ApiWindow).hronaut.selectTab(id), tabId)
    const back = await grows('shown again', background)
    // The app's own way: it hands the page from its debugger to Developer Tools, so the screencast ends and copies go on.
    const pageDebugger = () => electronApp.evaluate(({ webContents }, url) => {
      const page = webContents.getAllWebContents().find(contents => contents.getURL() === url)!
      return { devTools: page.isDevToolsOpened(), attached: page.debugger.isAttached() }
    }, fixtureUrl)
    expect(await appWindow.evaluate(id => (window as unknown as ApiWindow).hronaut.toggleDevTools(id), tabId)).toBe(true)
    await expect.poll(async () => (await pageDebugger()).devTools).toBe(true)
    const devTools = await grows('Developer Tools open', back)
    expect(await pageDebugger()).toEqual({ devTools: true, attached: false })
    await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.closeDevTools(), fixtureUrl)
    await grows('Developer Tools closed', devTools)
    // The screencast runs again once Developer Tools close.
    await expect.poll(async () => (await pageDebugger()).attached).toBe(true)
    const stopped = await video('stop')
    await testInfo.attach('video-background', { body: JSON.stringify(stopped), contentType: 'application/json' })
    expect(stopped.notice).toBeUndefined()
    await video('clear')
  } finally {
    await animate(electronApp, fixtureUrl, false).catch(() => undefined)
    if (other) await appWindow.evaluate(id => (window as unknown as ApiWindow).hronaut.closeTab(id), other).catch(() => undefined)
  }
})

test('a video of a page whose renderer crashed pauses instead of repeating its last frame', async ({ capabilities, electronApp }) => {
  const { client, tabId, fixtureUrl } = capabilities
  await waitForSettledPageBounds(electronApp, fixtureUrl)
  const video = async (action: string): Promise<BrowserVideoState> => JSON.parse(text(await client.callTool({ name: 'browser_video', arguments: { tabId, action } }) as CallToolResult)) as BrowserVideoState
  await video('start')
  await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(2)
  await electronApp.evaluate(({ webContents }, url) => webContents.getAllWebContents().find(page => page.getURL() === url)!.forcefullyCrashRenderer(), fixtureUrl)
  await expect.poll(async () => (await video('get')).status, { timeout: 10_000 }).toBe('paused')
  await video('clear')
})
