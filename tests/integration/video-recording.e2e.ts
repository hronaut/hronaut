import type { HronautApi, HronautMcpApi } from '../../src/shared/types.js'
type VideoTestWindow = Window & { hronaut: HronautApi; hronautMcp: HronautMcpApi }
import { readFile } from 'node:fs/promises'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { Input, BufferSource, WEBM } from 'mediabunny'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { expect, test, text } from './capability-fixtures.js'

// Exercises the real capture, sandboxed WebCodecs encoder, WebM muxer and browser decoder.
test('records, annotates, trims and decodes a WebM tutorial through MCP and the UI', async ({ capabilities, appWindow }) => {
  const { client, tabId, openPageTool } = capabilities
  const video = async (action: string, extra: Record<string, unknown> = {}): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  await video('start')
  await expect(appWindow.getByLabel('Recording video', { exact: true })).toBeVisible()
  await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(6)
  await video('pause')
  const paused = await video('get')
  await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: "document.body.style.background = '#17324d'; true" } })
  expect((await video('get')).durationMs).toBe(paused.durationMs)
  await video('resume')
  await expect.poll(async () => (await video('get')).frameCount).toBeGreaterThanOrEqual(paused.frameCount + 6)
  const stopped = await video('stop')
  const clipEnd = Math.floor(stopped.durationMs / 2)
  await video('edit', {
    clips: [{ startMs: 0, endMs: clipEnd }],
    annotations: [
      { kind: 'highlight', x: 0.1, y: 0.1, endX: 0.4, endY: 0.4, color: '#00ff00', startMs: 0, endMs: stopped.durationMs },
      { kind: 'arrow', x: 0.6, y: 0.6, endX: 0.8, endY: 0.8, startMs: 0, endMs: stopped.durationMs },
      { kind: 'text', text: 'Create your first campaign', x: 0.1, y: 0.8, startMs: 0, endMs: stopped.durationMs }
    ]
  })
  const exported = await video('export')
  expect(exported.exported).toMatchObject({ mimeType: 'video/webm', codec: 'vp9', durationMs: clipEnd })
  expect(exported.exported?.path).toMatch(/\.webm$/)
  const bytes = await readFile(exported.exported!.path)
  expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3])
  const media = new Input({ source: new BufferSource(bytes), formats: [WEBM] })
  try {
    const track = await media.getPrimaryVideoTrack()
    expect(track?.codec).toBe('vp9')
    expect(track?.displayWidth).toBe(stopped.width)
    expect(track?.displayHeight).toBe(stopped.height)
    expect(await media.computeDuration()).toBeCloseTo(clipEnd / 1000, 1)
  } finally { media.dispose() }
  const second = await video('export')
  expect(second.exported?.path).not.toBe(exported.exported?.path)
  expect(await readFile(exported.exported!.path)).toEqual(bytes)

  await openPageTool('Video recorder')
  const panel = appWindow.getByRole('region', { name: 'Video recorder' })
  await expect(panel.getByRole('button', { name: 'Preview video' })).toBeVisible()
  await panel.getByRole('button', { name: 'Preview video' }).click()
  const preview = panel.locator('video')
  await expect(preview).toBeVisible()
  await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  expect(await preview.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(stopped.width)
  // A green highlight border at a known normalized position proves overlays survived encoding.
  const pixel = await preview.evaluate((element: HTMLVideoElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0)
    return [...context.getImageData(Math.round(canvas.width * 0.1), Math.round(canvas.height * 0.25), 1, 1).data]
  })
  expect(pixel[1]).toBeGreaterThan(pixel[0]! + 70)
  expect(pixel[1]).toBeGreaterThan(pixel[2]! + 70)
  await panel.getByRole('button', { name: 'Discard recording' }).click()
  await expect(panel.getByRole('button', { name: 'Start video recording' })).toBeVisible()
  await expect(preview).toHaveCount(0)
})

test('records across same-origin navigation and refuses cross-workspace and changed-origin access', async ({ capabilities }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = async (action: string, extra: Record<string, unknown> = {}) => client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as Promise<CallToolResult>
  expect((await call('start')).isError).not.toBe(true)
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: `${fixtureUrl}?video=second-page` } })
  await expect.poll(async () => JSON.parse(text(await call('get'))).frameCount).toBeGreaterThan(2)
  const before = JSON.parse(text(await call('stop'))) as BrowserVideoState
  // Bypass the fixture's callTool wrapper, which always injects its own workspace.
  const denied = await client.request({ method: 'tools/call', params: { name: 'browser_video', arguments: { tabId, action: 'get', workspaceId: '018f0b20-1234-7000-8000-000000000001' } } }, CallToolResultSchema)
  expect(denied.isError).toBe(true)
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: 'about:blank' } })
  expect((await call('export')).isError).toBe(true)
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })
  const after = JSON.parse(text(await call('get'))) as BrowserVideoState
  expect(after.frameCount).toBe(before.frameCount)
  expect((await call('clear')).isError).not.toBe(true)
})

test('pauses an agent recording on human takeover and discards it when its tab closes', async ({ capabilities, appWindow }) => {
  const { client, tabId } = capabilities
  const start = await client.callTool({ name: 'browser_video', arguments: { tabId, action: 'start' } }) as CallToolResult
  expect(start.isError, text(start)).not.toBe(true)
  await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).frameCount, tabId)).toBeGreaterThan(1)
  await appWindow.evaluate(() => (window as unknown as VideoTestWindow).hronautMcp.setPaused(true))
  await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).status, tabId)).toBe('paused')
  const paused = await appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' }), tabId)
  await appWindow.evaluate(() => (window as unknown as VideoTestWindow).hronautMcp.setPaused(false))
  expect(await appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' }), tabId)).toMatchObject({ status: 'paused', frameCount: paused.frameCount })
  await appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.closeTab(id), tabId)
  await expect(appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' }), tabId)).rejects.toThrow()
})

test('human recording controls and annotation editor export a clip', async ({ capabilities, appWindow }, testInfo) => {
  await capabilities.openPageTool('Video recorder')
  const panel = appWindow.getByRole('region', { name: 'Video recorder' })
  await panel.getByRole('button', { name: 'Start video recording' }).click()
  await expect(panel.getByRole('button', { name: 'Pause video' })).toBeVisible()
  await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).durationMs, capabilities.tabId)).toBeGreaterThan(1100)
  await panel.getByRole('button', { name: 'Stop video' }).click()
  await panel.getByLabel('Caption text').fill('Open the project')
  await panel.getByRole('button', { name: 'Add annotation' }).click()
  await expect(panel.getByRole('button', { name: 'Remove annotation 1' })).toBeVisible()
  await panel.getByLabel('Annotation type').selectOption('arrow')
  await panel.getByRole('button', { name: 'Add annotation' }).click()
  await expect(panel.getByRole('button', { name: 'Remove annotation 2' })).toBeVisible()
  await panel.getByRole('button', { name: 'Export WebM' }).click()
  await expect(panel.locator('video')).toBeVisible()
  await expect(panel).toContainText('.webm')
  await panel.locator('video').scrollIntoViewIfNeeded()
  await appWindow.screenshot({ path: testInfo.outputPath('video-editor.png') })
})
