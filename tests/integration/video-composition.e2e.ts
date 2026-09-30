import { copyFile, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CallToolResultSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { BufferSource, Input, WEBM } from 'mediabunny'
import type { HronautApi, HronautMcpApi } from '../../src/shared/types.js'
import type { BrowserVideoState } from '../../src/shared/video.js'
import { expect, test, text } from './capability-fixtures.js'

type VideoTestWindow = Window & { hronaut: HronautApi; hronautMcp: HronautMcpApi }

// Original, deterministic sine tones generated for this test. No third-party
// recording, sample library, account data or redistribution license is involved.
function originalTone(frequency: number, durationMs: number, silentLeadMs = 0): Buffer {
  const sampleRate = 48_000
  const count = Math.round(durationMs * sampleRate / 1000)
  const bytes = Buffer.alloc(44 + count * 2)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28)
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40)
  for (let index = Math.round(silentLeadMs * sampleRate / 1000); index < count; index += 1) {
    bytes.writeInt16LE(Math.round(0.3 * 32767 * Math.sin(2 * Math.PI * frequency * index / sampleRate)), 44 + index * 2)
  }
  return bytes
}

test('exports original mixed audio, camera motion and transitions with decoded sound and frame evidence', async ({ capabilities, appWindow, profileDirectory }, testInfo) => {
  const { client, tabId, openPageTool } = capabilities
  const video = async (action: string, extra: Record<string, unknown> = {}): Promise<BrowserVideoState> => {
    const result = await client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as CallToolResult
    expect(result.isError, text(result)).not.toBe(true)
    return JSON.parse(text(result)) as BrowserVideoState
  }
  const prepared = await client.callTool({ name: 'browser_evaluate', arguments: {
    tabId,
    script: `document.body.innerHTML = '<style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#e4edf7}.target{position:absolute;left:70%;top:40%;width:10%;height:20%;background:#174fc7}</style><div class="target"></div>'; true`
  } }) as CallToolResult
  expect(prepared.isError, text(prepared)).not.toBe(true)
  await video('start')
  await expect.poll(async () => (await video('get')).durationMs).toBeGreaterThan(3050)
  const stopped = await video('stop')
  const tonePath = join(profileDirectory, 'original-tone.wav')
  const effectPath = join(profileDirectory, 'original-effect.wav')
  await writeFile(tonePath, originalTone(440, 2100, 100))
  await writeFile(effectPath, originalTone(880, 400))
  const toneState = await video('import-audio', {
    audioPath: tonePath, audioName: 'Original 440 Hz tone', audioProvenance: 'Original test-generated sine wave; no third-party assets.'
  })
  const tone = toneState.audioAssets!.find(asset => !asset.builtin)!
  const imported = await video('import-audio', {
    audioPath: effectPath, audioName: 'Original 880 Hz effect', audioProvenance: 'Original test-generated sine wave; no third-party assets.'
  })
  const effect = imported.audioAssets!.find(asset => !asset.builtin && asset.id !== tone.id)!
  expect(tone).toMatchObject({ name: 'Original 440 Hz tone', durationMs: 2100 })
  expect(JSON.stringify(imported.audioAssets)).not.toContain(profileDirectory)
  await video('edit', {
    clips: [{ startMs: 0, endMs: 1800 }, { startMs: 2200, endMs: 3000 }],
    audio: [
      { assetId: tone.id, startMs: 200, endMs: 2000, offsetMs: 100, volume: 0.5, fadeInMs: 400, fadeOutMs: 400 },
      { assetId: effect.id, startMs: 1100, endMs: 2300, volume: 0.5, fadeInMs: 100, fadeOutMs: 100, loop: true }
    ],
    cameras: [{ startMs: 500, endMs: 1600, x: 0.75, y: 0.5, zoom: 2, easeMs: 200 }],
    transition: { durationMs: 400 },
    annotations: [{ kind: 'text', text: 'Focus on the next step', placement: 'bottom-center', width: 0.58, animation: 'none', startMs: 0, endMs: 3000 }]
  })
  const exported = await video('export')
  expect(exported.exported).toMatchObject({ codec: 'vp9', audioCodec: 'opus', durationMs: 2600 })
  const bytes = await readFile(exported.exported!.path)
  const media = new Input({ source: new BufferSource(bytes), formats: [WEBM] })
  try {
    expect((await media.getPrimaryAudioTrack())?.codec).toBe('opus')
    expect((await media.getPrimaryVideoTrack())?.codec).toBe('vp9')
    expect(await media.computeDuration()).toBeCloseTo(2.6, 1)
  } finally { media.dispose() }

  // Decode the actual multiplexed WebM in Electron, independently of the mixer.
  // Opus includes a small codec tail; all windows avoid packet-edge ambiguity.
  const decoded = await appWindow.evaluate(async encoded => {
    const context = new AudioContext({ sampleRate: 48_000 })
    try {
      const buffer = await context.decodeAudioData(Uint8Array.from(atob(encoded), value => value.charCodeAt(0)).buffer)
      const pcm = buffer.getChannelData(0)
      const section = (startMs: number, endMs: number) => pcm.subarray(Math.round(startMs * buffer.sampleRate / 1000), Math.round(endMs * buffer.sampleRate / 1000))
      const rms = (startMs: number, endMs: number) => {
        const values = section(startMs, endMs)
        return Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length)
      }
      const amplitude = (frequency: number, startMs: number, endMs: number) => {
        const values = section(startMs, endMs)
        let sine = 0, cosine = 0
        for (let index = 0; index < values.length; index += 1) {
          const phase = 2 * Math.PI * frequency * index / buffer.sampleRate
          sine += values[index]! * Math.sin(phase); cosine += values[index]! * Math.cos(phase)
        }
        return 2 * Math.hypot(sine, cosine) / values.length
      }
      let peak = 0
      for (const value of pcm) peak = Math.max(peak, Math.abs(value))
      return {
        duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate, peak,
        silenceBefore: rms(20, 120), fadeIn: rms(260, 310), tone: rms(700, 800), overlap: rms(1250, 1400),
        fadeOut: rms(2230, 2270), silenceAfter: rms(2400, 2500),
        firstFrequency: amplitude(440, 1250, 1400), secondFrequency: amplitude(880, 1250, 1400),
        loopedFrequency: amplitude(880, 2020, 2120)
      }
    } finally { await context.close() }
  }, bytes.toString('base64'))
  expect(decoded.duration).toBeGreaterThanOrEqual(2.58)
  expect(decoded.duration).toBeLessThan(2.64)
  expect(decoded.channels).toBe(2)
  expect(decoded.silenceBefore).toBeLessThan(0.005)
  expect(decoded.silenceAfter).toBeLessThan(0.005)
  expect(decoded.tone).toBeGreaterThan(0.085)
  expect(decoded.tone).toBeLessThan(0.125)
  expect(decoded.fadeIn).toBeLessThan(decoded.tone * 0.4)
  expect(decoded.fadeOut).toBeLessThan(decoded.tone * 0.65)
  expect(decoded.overlap).toBeGreaterThan(decoded.tone * 1.2)
  expect(decoded.firstFrequency).toBeGreaterThan(0.12)
  expect(decoded.secondFrequency).toBeGreaterThan(0.12)
  expect(decoded.loopedFrequency).toBeGreaterThan(0.12)
  expect(decoded.peak).toBeLessThan(1.001)
  await testInfo.attach('decoded-audio-measurements', { body: JSON.stringify(decoded, null, 2), contentType: 'application/json' })
  await copyFile(exported.exported!.path, testInfo.outputPath('polished-composition.webm'))

  await openPageTool('Video recorder')
  const panel = appWindow.getByRole('region', { name: 'Video recorder' })
  await panel.getByRole('button', { name: 'Preview video' }).click()
  const preview = panel.locator('video')
  await expect.poll(() => preview.evaluate((element: HTMLVideoElement) => element.readyState)).toBeGreaterThanOrEqual(2)
  expect(await preview.evaluate((element: HTMLVideoElement) => element.videoWidth)).toBe(stopped.width)
  const sampleFrame = async (seconds: number) => {
    await preview.evaluate(async (element: HTMLVideoElement, time) => {
      element.pause(); element.controls = false
      await new Promise<void>(resolve => { element.addEventListener('seeked', () => resolve(), { once: true }); element.currentTime = time })
    }, seconds)
    return preview.evaluate((element: HTMLVideoElement) => {
      const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight
      const context = canvas.getContext('2d')!; context.drawImage(element, 0, 0)
      const sample = (x: number, y: number) => [...context.getImageData(Math.round(canvas.width * x), Math.round(canvas.height * y), 1, 1).data]
      const caption = context.getImageData(Math.round(canvas.width * 0.2), Math.round(canvas.height * 0.84), Math.round(canvas.width * 0.6), Math.round(canvas.height * 0.12)).data
      let brightTextPixels = 0
      for (let index = 0; index < caption.length; index += 4) {
        if (caption[index]! > 240 && caption[index + 1]! > 240 && caption[index + 2]! > 240) brightTextPixels += 1
      }
      return { center: sample(0.5, 0.5), corner: sample(0.05, 0.1), brightTextPixels }
    })
  }
  const wide = await sampleFrame(0.15)
  const focused = await sampleFrame(0.9)
  expect(wide.center[0]).toBeGreaterThan(190)
  expect(focused.center[2]).toBeGreaterThan(focused.center[0]! + 90)
  expect(focused.brightTextPixels).toBeGreaterThan(100)
  expect(Math.abs(focused.brightTextPixels - wide.brightTextPixels)).toBeLessThan(wide.brightTextPixels * 0.25)
  await preview.screenshot({ path: testInfo.outputPath('composition-focused.png') })
  const cut = await sampleFrame(1.85)
  const after = await sampleFrame(2.25)
  expect(cut.corner[0]).toBeLessThan(75)
  expect(after.center[0]).toBeGreaterThan(190)
  await testInfo.attach('decoded-video-measurements', { body: JSON.stringify({ wide, focused, cut, after }, null, 2), contentType: 'application/json' })
  await video('clear')
})

test('rejects invalid audio and unauthorized access without changing a retained composition', async ({ capabilities, appWindow, profileDirectory }) => {
  const { client, tabId, fixtureUrl } = capabilities
  const call = (action: string, extra: Record<string, unknown> = {}) => client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as Promise<CallToolResult>
  const state = async () => JSON.parse(text(await call('get'))) as BrowserVideoState
  expect((await call('start')).isError).not.toBe(true)
  await expect.poll(async () => (await state()).frameCount).toBeGreaterThan(2)
  expect((await call('stop')).isError).not.toBe(true)
  const invalidPath = join(profileDirectory, 'malformed.wav')
  const validPath = join(profileDirectory, 'authorized-original.wav')
  await writeFile(invalidPath, 'RIFF malformed input')
  await writeFile(validPath, originalTone(440, 1000))
  const before = await state()
  for (const audioPath of [invalidPath, join(profileDirectory, 'missing.wav'), 'relative.wav']) {
    const rejected = await call('import-audio', { audioPath, audioProvenance: 'Original test fixture.' })
    expect(rejected.isError, text(rejected)).toBe(true)
    expect((await state()).audioAssets).toEqual(before.audioAssets)
  }
  const foreign = await client.request({ method: 'tools/call', params: {
    name: 'browser_video', arguments: { tabId, action: 'import-audio', audioPath: validPath, audioProvenance: 'Original test fixture.', workspaceId: '018f0b20-1234-7000-8000-000000000001' }
  } }, CallToolResultSchema)
  expect(foreign.isError).toBe(true)
  await appWindow.evaluate(() => (window as unknown as VideoTestWindow).hronautMcp.setPaused(true))
  try {
    await expect(call('import-audio', { audioPath: validPath, audioProvenance: 'Original test fixture.' })).rejects.toThrow('paused')
  } finally { await appWindow.evaluate(() => (window as unknown as VideoTestWindow).hronautMcp.setPaused(false)) }
  await state()
  const workspaceId = await appWindow.evaluate(async id => (await (window as unknown as VideoTestWindow).hronaut.getState()).tabs.find(tab => tab.id === id)!.mcpGroupId!, tabId)
  const reclaimed = await client.callTool({ name: 'browser_workspaces', arguments: { action: 'claim-ownership', workspaceId } }) as CallToolResult
  expect(reclaimed.isError, text(reclaimed)).not.toBe(true)
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: 'about:blank' } })
  expect((await call('import-audio', { audioPath: validPath, audioProvenance: 'Original test fixture.' })).isError).toBe(true)
  await client.callTool({ name: 'browser_navigate', arguments: { tabId, url: fixtureUrl } })
  expect((await state()).audioAssets).toEqual(before.audioAssets)
  const importedResult = await call('import-audio', { audioPath: validPath, audioProvenance: 'Original test fixture.' })
  expect(importedResult.isError, text(importedResult)).not.toBe(true)
  const imported = JSON.parse(text(importedResult)) as BrowserVideoState
  const assetId = imported.audioAssets!.find(asset => !asset.builtin)!.id
  expect((await call('edit', { audio: [{ assetId, startMs: 0, endMs: Math.min(200, imported.durationMs) }] })).isError).not.toBe(true)
  const edited = await state()
  const missing = await call('edit', { audio: [{ assetId: 'missing-asset', startMs: 0, endMs: 100 }], annotations: [] })
  expect(missing.isError).toBe(true)
  expect((await state()).audio).toEqual(edited.audio)
  expect((await call('remove-audio', { assetId })).isError).toBe(true)
  expect((await state()).audioAssets).toEqual(edited.audioAssets)
  expect((await call('edit', { audio: [] })).isError).not.toBe(true)
  expect((await call('remove-audio', { assetId })).isError).not.toBe(true)
  expect((await state()).audioAssets).toEqual(before.audioAssets)
  expect((await call('clear')).isError).not.toBe(true)
})

test('clearing a composition cancels its live audio renderer before an export file is written', async ({ capabilities, appWindow, profileDirectory }) => {
  const { client, tabId } = capabilities
  const call = (action: string, extra: Record<string, unknown> = {}) => client.callTool({ name: 'browser_video', arguments: { tabId, action, ...extra } }) as Promise<CallToolResult>
  expect((await call('start')).isError).not.toBe(true)
  await expect.poll(async () => (JSON.parse(text(await call('get'))) as BrowserVideoState).durationMs).toBeGreaterThan(1500)
  const stopped = JSON.parse(text(await call('stop'))) as BrowserVideoState
  const asset = stopped.audioAssets!.find(item => item.builtin)!
  expect((await call('edit', { audio: [{ assetId: asset.id, startMs: 0, endMs: stopped.durationMs, loop: true }] })).isError).not.toBe(true)
  const before = (await readdir(profileDirectory)).filter(name => name.endsWith('.webm'))
  const pending = call('export')
  await expect.poll(() => appWindow.evaluate(async id => (await (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' })).status, tabId), { intervals: [20] }).toBe('rendering')
  await appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'clear' }), tabId)
  const cancelled = await pending
  expect(cancelled.isError, text(cancelled)).toBe(true)
  expect((await readdir(profileDirectory)).filter(name => name.endsWith('.webm'))).toEqual(before)
  expect(await appWindow.evaluate(id => (window as unknown as VideoTestWindow).hronaut.manageVideo({ tabId: id, action: 'get' }), tabId)).toMatchObject({ status: 'idle', previewReady: false })
})
