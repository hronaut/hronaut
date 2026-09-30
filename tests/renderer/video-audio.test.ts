import { afterEach, describe, expect, it, vi } from 'vitest'
import { VIDEO_AUDIO_BUILTINS, VIDEO_AUDIO_LIMITS, generateVideoAudioBuiltin, normalizeVideoAudioWav, parseVideoAudioWav } from '../../src/shared/video-audio.js'
import type { VideoAudioEvent } from '../../src/shared/video.js'

const codec = vi.hoisted(() => ({ canEncodeAudio: vi.fn(async () => true) }))
vi.mock('mediabunny', () => codec)
import { ensureVideoAudioEncoding, mixVideoAudio, mixVideoAudioPcm } from '../../src/renderer/src/video/audio.js'

function chunk(kind: string, data: Uint8Array): Uint8Array {
  const bytes = new Uint8Array(8 + data.length + data.length % 2)
  bytes.set(new TextEncoder().encode(kind))
  new DataView(bytes.buffer).setUint32(4, data.length, true)
  bytes.set(data, 8)
  return bytes
}
function riff(chunks: Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(12 + chunks.reduce((sum, part) => sum + part.length, 0))
  bytes.set(new TextEncoder().encode('RIFF'))
  new DataView(bytes.buffer).setUint32(4, bytes.length - 8, true)
  bytes.set(new TextEncoder().encode('WAVE'), 8)
  let position = 12
  for (const part of chunks) { bytes.set(part, position); position += part.length }
  return bytes
}
function wav(durationMs = 100, sampleRate = 8_000, values = [0.5], metadata = false): Uint8Array {
  const format = new Uint8Array(16)
  const f = new DataView(format.buffer)
  f.setUint16(0, 1, true); f.setUint16(2, values.length, true); f.setUint32(4, sampleRate, true)
  f.setUint32(8, sampleRate * values.length * 2, true); f.setUint16(12, values.length * 2, true); f.setUint16(14, 16, true)
  const samples = new Uint8Array(Math.round(durationMs * sampleRate / 1000) * values.length * 2)
  const s = new DataView(samples.buffer)
  for (let index = 0; index < samples.length / 2; index++) s.setInt16(index * 2, Math.round(values[index % values.length] * 32768), true)
  const parts = [chunk('fmt ', format)]
  if (metadata) parts.push(chunk('LIST', new TextEncoder().encode('private source name')))
  parts.push(chunk('data', samples))
  return riff(parts)
}
function event(overrides: Partial<VideoAudioEvent> = {}): VideoAudioEvent {
  return { assetId: 'import:one', startMs: 0, endMs: 100, offsetMs: 0, volume: 1, fadeInMs: 0, fadeOutMs: 0, loop: false, ...overrides }
}
function sample(channel: Float32Array, atMs: number): number { return channel[Math.round(atMs * 48)] }

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('bounded PCM16 WAV import', () => {
  it('parses stereo samples with channel separation and a sliced backing buffer', () => {
    const source = wav(100, 48_000, [0.25, -0.5])
    const backing = new Uint8Array(source.length + 17)
    backing.set(source, 9)
    const parsed = parseVideoAudioWav(backing.subarray(9, 9 + source.length))
    expect(parsed.sampleRate).toBe(48_000)
    expect(parsed.durationMs).toBe(100)
    expect(parsed.channels.map(channel => channel.length)).toEqual([4_800, 4_800])
    expect(parsed.channels[0][200]).toBe(0.25)
    expect(parsed.channels[1][200]).toBe(-0.5)
  })

  it('normalizes into a minimal WAV while preserving samples and stripping metadata', () => {
    const source = wav(100, 44_100, [0.25], true)
    const normalized = normalizeVideoAudioWav(source)
    expect(normalized.sampleRate).toBe(44_100)
    expect(normalized.channelCount).toBe(1)
    expect(normalized.durationMs).toBe(100)
    expect(normalized.data).toEqual(wav(100, 44_100, [0.25]))
    expect(new TextDecoder().decode(normalized.data)).not.toContain('private source name')
    expect(normalizeVideoAudioWav(normalized.data).data).toEqual(normalized.data)
    normalized.data.fill(0)
    expect(parseVideoAudioWav(source).channels[0][0]).toBe(0.25)
  })

  it.each([
    ['RIFF length mismatch', (data: Uint8Array) => { new DataView(data.buffer).setUint32(4, data.length, true) }],
    ['non-WAVE payload', (data: Uint8Array) => { data[8] = 0 }],
    ['compressed audio', (data: Uint8Array) => { new DataView(data.buffer).setUint16(20, 3, true) }],
    ['24-bit samples', (data: Uint8Array) => { new DataView(data.buffer).setUint16(34, 24, true) }],
    ['multichannel audio', (data: Uint8Array) => { new DataView(data.buffer).setUint16(22, 6, true) }],
    ['unbounded sample rate', (data: Uint8Array) => { new DataView(data.buffer).setUint32(24, 192_000, true) }],
    ['inconsistent byte rate', (data: Uint8Array) => { new DataView(data.buffer).setUint32(28, 1, true) }],
    ['inconsistent sample stride', (data: Uint8Array) => { new DataView(data.buffer).setUint16(32, 4, true) }],
    ['truncated data', (data: Uint8Array) => { new DataView(data.buffer).setUint32(40, data.length, true) }],
    ['empty audio', (data: Uint8Array) => { new DataView(data.buffer).setUint32(40, 0, true) }]
  ])('rejects %s', (_name, mutate) => {
    const data = wav()
    mutate(data)
    expect(() => parseVideoAudioWav(data)).toThrow()
    expect(() => normalizeVideoAudioWav(data)).toThrow()
  })

  it('rejects duplicate format/data chunks, partial frames and too many chunks', () => {
    const source = wav()
    const format = source.slice(12, 36)
    const data = source.slice(36)
    expect(() => parseVideoAudioWav(riff([format, format, data]))).toThrow('Unsupported WAV format')
    expect(() => parseVideoAudioWav(riff([format, data, data]))).toThrow('one non-empty')
    expect(() => parseVideoAudioWav(riff([format, chunk('data', new Uint8Array(3))]))).toThrow('PCM16 WAV')
    expect(() => parseVideoAudioWav(riff([format, ...Array.from({ length: 128 }, () => chunk('JUNK', new Uint8Array())), data]))).toThrow('Malformed WAV chunks')
  })

  it('rejects missing chunks, partial chunk headers and unsupported format extensions', () => {
    const source = wav()
    expect(() => parseVideoAudioWav(riff([source.slice(36)]))).toThrow('missing')
    expect(() => parseVideoAudioWav(riff([source.slice(12, 36), chunk('JUNK', new Uint8Array(8))]))).toThrow('missing')
    expect(() => parseVideoAudioWav(riff([source.slice(12), new Uint8Array(1)]))).toThrow('Malformed WAV chunks')
    const extended = new Uint8Array(18)
    extended.set(source.subarray(20, 36))
    extended[16] = 1
    expect(() => parseVideoAudioWav(riff([chunk('fmt ', extended), source.slice(36)]))).toThrow('format extension')
  })

  it('enforces duration and input byte bounds before decoding', () => {
    expect(() => parseVideoAudioWav(wav(120_001))).toThrow('two minutes')
    expect(() => parseVideoAudioWav(new Uint8Array(VIDEO_AUDIO_LIMITS.bytes + 1))).toThrow('10 MiB')
    expect(() => parseVideoAudioWav(new Uint8Array())).toThrow('10 MiB')
  })
})

describe('original audio assets', () => {
  it.each(VIDEO_AUDIO_BUILTINS)('generates deterministic bounded $id with provenance and no abrupt endpoints', ({ id, durationMs, provenance }) => {
    const first = generateVideoAudioBuiltin(id)
    const second = generateVideoAudioBuiltin(id)
    expect(first.sampleRate).toBe(48_000)
    expect(first.durationMs).toBe(durationMs)
    expect(first.channels[0]).toEqual(second.channels[0])
    expect(first.channels[0][0]).toBe(0)
    expect(Math.abs(first.channels[0].at(-1)!)).toBeLessThan(1e-12)
    expect(first.channels[0].some(value => Math.abs(value) > 0.01)).toBe(true)
    expect(first.channels[0].every(value => Number.isFinite(value) && Math.abs(value) < 0.6)).toBe(true)
    expect(provenance).toContain('no third-party samples')
  })
  it('rejects unknown builtin names', () => { expect(() => generateVideoAudioBuiltin('builtin:unknown')).toThrow('Unknown') })
})

describe('deterministic output-timeline audio mixing', () => {
  it('places audio exactly in its edited output range with stereo resampling and silence elsewhere', async () => {
    const pcm = await mixVideoAudioPcm([event({ startMs: 50, endMs: 150 })], [{ id: 'import:one', data: wav(100, 8_000, [0.5, -0.25]) }], 200)
    expect(pcm.channels.map(channel => channel.length)).toEqual([9_600, 9_600])
    expect(pcm.sampleRate).toBe(48_000)
    expect(pcm.channels[0].slice(0, 2_400).every(value => value === 0)).toBe(true)
    expect(sample(pcm.channels[0], 75)).toBe(0.5)
    expect(sample(pcm.channels[1], 75)).toBe(-0.25)
    expect(pcm.channels[0].slice(7_200).every(value => value === 0)).toBe(true)
    expect(sample(pcm.channels[0], 50)).toBe(0)
  })

  it('uses asset offsets, repeats when requested and otherwise stops at the source end', async () => {
    const assets = [{ id: 'import:one', data: wav(50) }]
    const once = await mixVideoAudioPcm([event({ offsetMs: 20 })], assets, 100)
    const repeat = await mixVideoAudioPcm([event({ offsetMs: 20, loop: true })], assets, 100)
    expect(sample(once.channels[0], 10)).toBe(0.5)
    expect(sample(once.channels[0], 40)).toBe(0)
    expect(sample(repeat.channels[0], 40)).toBe(0.5)
    expect(sample(repeat.channels[0], 70)).toBe(0.5)
    expect(sample(repeat.channels[0], 30)).toBe(0)
  })

  it('applies linear volume and fades while duplicating mono into both channels', async () => {
    const pcm = await mixVideoAudioPcm([event({ volume: 0.5, fadeInMs: 40, fadeOutMs: 40 })], [{ id: 'import:one', data: wav() }], 100)
    expect(sample(pcm.channels[0], 20)).toBeCloseTo(0.125, 5)
    expect(sample(pcm.channels[0], 50)).toBe(0.25)
    expect(sample(pcm.channels[0], 80)).toBeCloseTo(0.125, 3)
    expect(pcm.channels[0]).toEqual(pcm.channels[1])
    expect(pcm.channels[0].at(-1)).toBe(0)
  })

  it('mixes overlapping events and uses one constant gain to preserve dynamics without clipping', async () => {
    const assets = [{ id: 'import:one', data: wav(100, 8_000, [0.75]) }]
    const pcm = await mixVideoAudioPcm([event(), event({ startMs: 25, endMs: 75 })], assets, 100)
    expect(pcm.gain).toBeCloseTo(0.95 / 1.5, 6)
    expect(sample(pcm.channels[0], 50)).toBeCloseTo(0.95, 6)
    expect(sample(pcm.channels[0], 10)).toBeCloseTo(0.475, 6)
    expect(pcm.channels.every(channel => channel.every(value => Math.abs(value) <= 0.95))).toBe(true)
    expect(pcm.peak).toBe(0.95)
  })

  it('can select built-ins without imported data and produces identical PCM on repeated renders', async () => {
    const events = [event({ assetId: 'builtin:chime', endMs: 400, volume: 0.5 })]
    const first = await mixVideoAudioPcm(events, [], 400)
    const second = await mixVideoAudioPcm(events, [], 400)
    expect(first.channels).toEqual(second.channels)
    expect(first.channels[0].some(value => Math.abs(value) > 0.05)).toBe(true)
  })

  it('returns silence for muted or absent events without division by zero', async () => {
    for (const events of [[], [event({ assetId: 'builtin:click', volume: 0 })]]) {
      const result = await mixVideoAudioPcm(events, [], 100)
      expect(result.gain).toBe(1)
      expect(result.peak).toBe(0)
      expect(result.channels.every(channel => channel.every(value => value === 0))).toBe(true)
    }
  })

  it.each([
    { startMs: -1 }, { endMs: 0 }, { endMs: 101 }, { offsetMs: -1 }, { volume: 1.1 },
    { volume: Number.NaN }, { fadeInMs: -1 }, { fadeInMs: 60, fadeOutMs: 60 }, { startMs: Number.POSITIVE_INFINITY }
  ])('rejects invalid event parameters %o', async overrides => {
    await expect(mixVideoAudioPcm([event(overrides)], [], 100)).rejects.toThrow('Invalid audio timing or volume')
  })

  it('rejects missing assets, offset outside the asset, or malformed supplied audio', async () => {
    await expect(mixVideoAudioPcm([event()], [], 100)).rejects.toThrow('missing')
    await expect(mixVideoAudioPcm([event({ offsetMs: 100 })], [{ id: 'import:one', data: wav() }], 100)).rejects.toThrow('offset')
    await expect(mixVideoAudioPcm([event()], [{ id: 'import:one', data: new Uint8Array(1) }], 100)).rejects.toThrow('WAV')
  })

  it('enforces event, asset, duration and aggregate memory limits', async () => {
    await expect(mixVideoAudioPcm(Array.from({ length: 33 }, () => event()), [], 100)).rejects.toThrow('limits')
    await expect(mixVideoAudioPcm([], Array.from({ length: 9 }, (_, id) => ({ id: String(id), data: wav() })), 100)).rejects.toThrow('limits')
    await expect(mixVideoAudioPcm([], [], 120_001)).rejects.toThrow('limits')
    await expect(mixVideoAudioPcm([], [], Number.NaN)).rejects.toThrow('limits')
    await expect(mixVideoAudioPcm([], [{ id: 'builtin:ambient', data: wav() }], 100)).rejects.toThrow('Invalid imported')
    await expect(mixVideoAudioPcm([], [{ id: 'duplicate', data: wav() }, { id: 'duplicate', data: wav() }], 100)).rejects.toThrow('Invalid imported')
    await expect(mixVideoAudioPcm([], Array.from({ length: 4 }, (_, id) => ({ id: String(id), data: new Uint8Array(9 * 1024 * 1024) })), 100)).rejects.toThrow('memory limit')
  })

  it('honors cancellation before work and after yielding during a long mix', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(mixVideoAudioPcm([], [], 100, aborted.signal)).rejects.toThrow('cancelled')
    const controller = new AbortController()
    const promise = mixVideoAudioPcm([event({ assetId: 'builtin:ambient', endMs: 120_000, loop: true })], [], 120_000, controller.signal)
    setTimeout(() => controller.abort(), 0)
    await expect(promise).rejects.toThrow('cancelled')
  })

  it('constructs an AudioBuffer from real mixed channel samples', async () => {
    class TestAudioBuffer {
      channels: Float32Array[]
      sampleRate: number
      constructor(options: AudioBufferOptions) {
        this.sampleRate = options.sampleRate
        this.channels = Array.from({ length: options.numberOfChannels ?? 1 }, () => new Float32Array(options.length))
      }
      copyToChannel(source: Float32Array, channel: number): void { this.channels[channel].set(source) }
    }
    vi.stubGlobal('AudioBuffer', TestAudioBuffer)
    const result = await mixVideoAudio([event()], [{ id: 'import:one', data: wav() }], 100) as unknown as TestAudioBuffer
    expect(result.sampleRate).toBe(48_000)
    expect(result.channels.length).toBe(2)
    expect(sample(result.channels[0], 50)).toBe(0.5)
  })

  it('checks the actual codec parameters and fails explicitly when Opus is unavailable', async () => {
    await ensureVideoAudioEncoding()
    expect(codec.canEncodeAudio).toHaveBeenCalledWith('opus', { sampleRate: 48_000, numberOfChannels: 2, bitrate: 128_000 })
    codec.canEncodeAudio.mockResolvedValueOnce(false)
    await expect(ensureVideoAudioEncoding()).rejects.toThrow('Opus audio encoding is unavailable')
  })
})

it('keeps a positive sub-sample duration representable as one output sample', async () => {
  const mixed = await mixVideoAudioPcm([], [], 0.001)
  expect(mixed.channels[0].length).toBe(1)
  expect(mixed.durationMs).toBeGreaterThan(0)
})
