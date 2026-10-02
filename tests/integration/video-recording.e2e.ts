import type { HronautApi, HronautMcpApi } from '../../src/shared/types.js'
type VideoTestWindow = Window & { hronaut: HronautApi; hronautMcp: HronautMcpApi }
import { copyFile, readFile } from 'node:fs/promises'
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
  expect(stopped.timing).toMatchObject({ sourceTimeMs: stopped.durationMs, pixelTime: 'unknown' })
  const clipEnd = Math.floor(stopped.durationMs / 2)
  await video('edit', {
    clips: [{ startMs: 0, endMs: clipEnd }],
    annotations: [
      { kind: 'highlight', x: 0.1, y: 0.1, endX: 0.4, endY: 0.4, color: '#00ff00', animation: 'none', startMs: 0, endMs: stopped.durationMs },
      { kind: 'arrow', x: 0.6, y: 0.6, endX: 0.8, endY: 0.8, startMs: 0, endMs: stopped.durationMs },
      { kind: 'text', text: 'Create your first campaign', x: 0.1, y: 0.8, startMs: 0, endMs: stopped.durationMs }
    ]
  })
  const exported = await video('export')
  expect(exported.recordingId).toBe(stopped.recordingId)
  expect(exported.timing?.sourceTimeMs).toBe(stopped.durationMs)
  expect(exported.timing!.revision).toBeGreaterThan(stopped.timing!.revision)
  expect(exported.timing?.lastFrame).toEqual(stopped.timing?.lastFrame)
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

test('exports positioned captions, step cards and a spotlight with readable compositing', async ({ capabilities, appWindow }, testInfo) => {
  const { client, tabId, openPageTool } = capabilities
  // Entirely synthetic product UI; no external account, screenshot or recording assets.
  const scene = `document.body.innerHTML = \`<style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;font-family:Arial,sans-serif;background:#edf2fa;color:#18243d}
    .brand{position:absolute;left:5%;top:7%;font-size:22px;font-weight:700;letter-spacing:-.5px}
    .brand span{display:inline-block;background:#7c3aed;color:white;padding:8px 12px;border-radius:12px;margin-right:10px}
    .card{position:absolute;left:45%;top:25%;width:42%;height:48%;box-sizing:border-box;padding:4%;background:white;border:1px solid #dce3f0;border-radius:22px;box-shadow:0 20px 60px #20324c10}
    .eyebrow{font-size:12px;font-weight:700;letter-spacing:2px;color:#7c3aed}
    h1{font-size:30px;margin:15px 0 12px;letter-spacing:-1px}p{color:#68748c;font-size:16px;line-height:1.6}
    .input{border:1px solid #dce3f0;border-radius:9px;padding:13px;font-size:14px;color:#68748c;margin-top:20px}
    .button{position:absolute;left:66%;top:63%;width:18%;height:7%;display:grid;place-items:center;border-radius:9px;background:#7c3aed;color:white;font-size:15px;font-weight:700}
    .footer{position:absolute;left:5%;bottom:7%;font-size:12px;letter-spacing:1px;color:#68748c}
    </style><div class="brand"><span>P</span>Project studio</div><div class="card"><div class="eyebrow">WORKSPACE</div><h1>Make room for your team.</h1><p>Bring the right people into your next project.</p><div class="input">teammate@example.test</div></div><div class="button">Send invite →</div><div class="footer">YOUR NEXT IDEA STARTS HERE</div>\`; true`
  const prepared = await client.callTool({ name: 'browser_evaluate', arguments: { tabId, script: scene } }) as CallToolResult
  expect(prepared.isError, text(prepared)).not.toBe(true)
  const video = async (action: string, extra: Record<string, unknown> = {}) => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  await video('start')
  await expect.poll(async () => (await video('get')).durationMs).toBeGreaterThan(1800)
  const stopped = await video('stop')
  const timing = { startMs: 0, endMs: stopped.durationMs }
  const edited = await video('edit', { annotations: [
    { ...timing, kind: 'callout', title: 'INVITE YOUR TEAM', step: 2, text: 'Add a teammate, then choose Send invite.', placement: 'center-left', width: 0.31, endX: 0.65, endY: 0.665 },
    { ...timing, kind: 'text', preset: 'caption', placement: 'bottom-center', align: 'center', width: 0.58, text: 'Your workspace is ready.\nInvite teammates to keep building together.' },
    { ...timing, kind: 'text', preset: 'label', placement: 'custom', x: 0.045, y: 0.16, theme: 'light', text: '02 / Invite collaborators' },
    // Deliberately last: spotlights must still composite behind cards.
    { ...timing, kind: 'spotlight', x: 0.44, y: 0.24, endX: 0.88, endY: 0.74 }
  ] })
  expect(edited.annotations[0]).toMatchObject({ placement: 'center-left', width: 0.31, step: 2 })
  const exported = await video('export')
  await copyFile(exported.exported!.path, testInfo.outputPath('annotation-styles.webm'))
  await openPageTool('Video recorder')
  const panel = appWindow.getByRole('region', { name: 'Video recorder' })
  await panel.getByRole('button', { name: 'Preview video' }).click()
  const preview = panel.locator('video')
  await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  await preview.evaluate((element: HTMLVideoElement) => { element.currentTime = 0.8; element.controls = false })
  await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.seeking)).toBe(false)
  const pixels = await preview.evaluate((element: HTMLVideoElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight
    const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0)
    const sample = (x: number, y: number) => [...context.getImageData(Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data]
    const card = context.getImageData(Math.round(canvas.width * 0.04), Math.round(canvas.height * 0.38), Math.round(canvas.width * 0.27), Math.round(canvas.height * 0.25)).data
    let brightTextPixels = 0
    for (let index = 0; index < card.length; index += 4) if (card[index]! > 220 && card[index + 1]! > 220 && card[index + 2]! > 220) brightTextPixels += 1
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const lines: Array<{ left: number; right: number }> = []
    let current: { left: number; right: number } | undefined
    let lastInkRow = -Infinity
    for (let y = Math.round(canvas.height * 0.82); y < canvas.height * 0.96; y += 1) {
      let left = canvas.width, right = -1
      for (let x = Math.round(canvas.width * 0.15); x < canvas.width * 0.85; x += 1) {
        const offset = (y * canvas.width + x) * 4
        if (image.data[offset]! > 210 && image.data[offset + 1]! > 210 && image.data[offset + 2]! > 210) { left = Math.min(left, x); right = x }
      }
      if (right >= left) {
        // Decoded text can have one or two blank raster rows before descenders.
        // Keep those in their line without merging the larger inter-line gap.
        if (!current || y - lastInkRow > 3) { current = { left, right }; lines.push(current) }
        else { current.left = Math.min(current.left, left); current.right = Math.max(current.right, right) }
        lastInkRow = y
      }
    }
    return { outside: sample(0.95, 0.5), inside: sample(0.86, 0.3), customLabel: sample(0.065, 0.175), brightTextPixels, captionCenters: lines.map(line => (line.left + line.right) / 2) }
  })
  expect(pixels.inside[0]).toBeGreaterThan(pixels.outside[0]! + 80)
  expect(pixels.brightTextPixels).toBeGreaterThan(100)
  expect(pixels.customLabel.slice(0, 3).every(channel => channel > 200)).toBe(true)
  expect(pixels.captionCenters).toHaveLength(2)
  expect(Math.abs(pixels.captionCenters[0]! - pixels.captionCenters[1]!)).toBeLessThan(6)
  await preview.screenshot({ path: testInfo.outputPath('annotation-styles.png') })
  await video('clear')
})
