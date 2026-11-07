import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { test, expect, text } from './capability-fixtures.js'
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
  const stream = async (args: Record<string, unknown>) => {
    const result = await client.callTool({ name: 'browser_frame_stream', arguments: { tabId, ...args } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as { status: string; cursor: number }
  }
  try {
    await stream({ action: 'start', maxWidth: 320, maxHeight: 180, quality: 50 })
    await video('start')
    await expect.poll(async () => (await video('get')).durationMs, { timeout: 10_000 }).toBeGreaterThanOrEqual(2000)
    const stopped = await video('stop')
    await testInfo.attach('video-frame-rate', { body: JSON.stringify(stopped), contentType: 'application/json' })
    // The old capture copied the page every 83 ms plus its own ~30 ms, about 9 frames a second.
    expect(stopped.frameCount * 1000 / stopped.durationMs).toBeGreaterThanOrEqual(24)
    expect(stopped.width).toBeGreaterThan(0)
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
