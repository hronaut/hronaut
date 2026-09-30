/** Audio assets never carry a path into the renderer; main owns all file access. */
export const VIDEO_AUDIO_LIMITS = {
  bytes: 10 * 1024 * 1024,
  totalBytes: 32 * 1024 * 1024,
  assets: 8,
  events: 32,
  durationMs: 120_000,
  minSampleRate: 8_000,
  maxSampleRate: 48_000,
  sampleRate: 48_000,
  channels: 2,
  bitrate: 128_000,
  peak: 0.95
} as const

const originalProvenance = 'Original Hronaut synthesis; mathematical oscillators only, no third-party samples. See docs/VIDEO_AUDIO_PROVENANCE.md.'
export const VIDEO_AUDIO_BUILTINS = [
  { id: 'builtin:ambient', name: 'Gentle ambient', durationMs: 8_000, provenance: originalProvenance, builtin: true },
  { id: 'builtin:click', name: 'Soft click', durationMs: 120, provenance: originalProvenance, builtin: true },
  { id: 'builtin:chime', name: 'Completion chime', durationMs: 800, provenance: originalProvenance, builtin: true }
] as const

export interface VideoAudioPcm {
  sampleRate: number
  channels: Float32Array[]
  durationMs: number
}

interface WavInfo {
  view: DataView
  sampleRate: number
  channelCount: number
  sampleCount: number
  durationMs: number
  dataOffset: number
  dataBytes: number
}

function fourCc(view: DataView, offset: number): string {
  return String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3))
}

/** Strict, allocation-bounded PCM16 RIFF/WAVE reader. Does not invoke media decoders. */
function inspectWav(bytes: Uint8Array): WavInfo {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 44 || bytes.byteLength > VIDEO_AUDIO_LIMITS.bytes) {
    throw new Error('Audio must be a non-empty WAV file no larger than 10 MiB')
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (fourCc(view, 0) !== 'RIFF' || fourCc(view, 8) !== 'WAVE' || view.getUint32(4, true) !== bytes.byteLength - 8) {
    throw new Error('Audio must be a complete RIFF/WAVE file')
  }
  let formatOffset = -1
  let dataOffset = -1
  let dataBytes = 0
  let chunkCount = 0
  for (let offset = 12; offset < bytes.byteLength;) {
    if (++chunkCount > 128 || offset + 8 > bytes.byteLength) throw new Error('Malformed WAV chunks')
    const kind = fourCc(view, offset)
    const length = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + length
    const paddedEnd = end + (length % 2)
    if (paddedEnd > bytes.byteLength) throw new Error('Truncated WAV chunk')
    if (kind === 'fmt ') {
      if (formatOffset !== -1 || (length !== 16 && length !== 18)) throw new Error('Unsupported WAV format')
      if (length === 18 && view.getUint16(start + 16, true) !== 0) throw new Error('Unsupported WAV format extension')
      formatOffset = start
    } else if (kind === 'data') {
      if (dataOffset !== -1 || length === 0) throw new Error('WAV must have one non-empty audio data chunk')
      dataOffset = start
      dataBytes = length
    }
    offset = paddedEnd
  }
  if (formatOffset === -1 || dataOffset === -1) throw new Error('WAV format or audio data is missing')
  const channelCount = view.getUint16(formatOffset + 2, true)
  const sampleRate = view.getUint32(formatOffset + 4, true)
  const blockAlign = view.getUint16(formatOffset + 12, true)
  if (view.getUint16(formatOffset, true) !== 1 || view.getUint16(formatOffset + 14, true) !== 16
    || (channelCount !== 1 && channelCount !== 2)
    || sampleRate < VIDEO_AUDIO_LIMITS.minSampleRate || sampleRate > VIDEO_AUDIO_LIMITS.maxSampleRate
    || blockAlign !== channelCount * 2 || view.getUint32(formatOffset + 8, true) !== sampleRate * blockAlign
    || dataBytes % blockAlign !== 0) {
    throw new Error('Supported audio is PCM16 WAV, mono or stereo, at 8–48 kHz')
  }
  const sampleCount = dataBytes / blockAlign
  const durationMs = sampleCount * 1000 / sampleRate
  if (durationMs > VIDEO_AUDIO_LIMITS.durationMs) throw new Error('Audio must be no longer than two minutes')
  return { view, sampleRate, channelCount, sampleCount, durationMs, dataOffset, dataBytes }
}

/** Rebuild the container from validated samples, discarding names, tags and other chunks. */
export function normalizeVideoAudioWav(bytes: Uint8Array): { data: Uint8Array; sampleRate: number; channelCount: number; durationMs: number } {
  const info = inspectWav(bytes)
  const data = new Uint8Array(44 + info.dataBytes)
  const view = new DataView(data.buffer)
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index++) view.setUint8(offset + index, value.charCodeAt(index))
  }
  write(0, 'RIFF'); view.setUint32(4, data.length - 8, true); write(8, 'WAVE')
  write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, info.channelCount, true); view.setUint32(24, info.sampleRate, true)
  view.setUint32(28, info.sampleRate * info.channelCount * 2, true)
  view.setUint16(32, info.channelCount * 2, true); view.setUint16(34, 16, true)
  write(36, 'data'); view.setUint32(40, info.dataBytes, true)
  data.set(bytes.subarray(info.dataOffset, info.dataOffset + info.dataBytes), 44)
  return { data, sampleRate: info.sampleRate, channelCount: info.channelCount, durationMs: info.durationMs }
}

export function parseVideoAudioWav(bytes: Uint8Array): VideoAudioPcm {
  const info = inspectWav(bytes)
  const channels = Array.from({ length: info.channelCount }, () => new Float32Array(info.sampleCount))
  for (let frame = 0; frame < info.sampleCount; frame++) {
    for (let channel = 0; channel < info.channelCount; channel++) {
      channels[channel]![frame] = info.view.getInt16(info.dataOffset + (frame * info.channelCount + channel) * 2, true) / 32768
    }
  }
  return { channels, sampleRate: info.sampleRate, durationMs: info.durationMs }
}

/** Original, deterministic sounds. No network, random source, recordings, or external assets. */
export function generateVideoAudioBuiltin(id: string): VideoAudioPcm {
  const definition = VIDEO_AUDIO_BUILTINS.find(asset => asset.id === id)
  if (!definition) throw new Error('Unknown built-in audio asset')
  const sampleRate = VIDEO_AUDIO_LIMITS.sampleRate
  const length = Math.round(definition.durationMs * sampleRate / 1000)
  const samples = new Float32Array(length)
  for (let index = 0; index < length; index++) {
    const time = index / sampleRate
    const phase = index / (length - 1)
    if (id === 'builtin:ambient') {
      // A gentle C-major pad. A zero-slope envelope makes the eight-second repeat click-free.
      const envelope = Math.sin(Math.PI * phase) ** 2
      samples[index] = 0.13 * envelope * (Math.sin(2 * Math.PI * 130.81278265 * time)
        + 0.65 * Math.sin(2 * Math.PI * 164.81377846 * time)
        + 0.5 * Math.sin(2 * Math.PI * 195.99771799 * time)) / 2.15
    } else if (id === 'builtin:click') {
      const envelope = Math.min(1, time / 0.002) * Math.exp(-time * 65) * (1 - phase)
      samples[index] = 0.5 * envelope * (Math.sin(2 * Math.PI * 760 * time) + 0.25 * Math.sin(2 * Math.PI * 1520 * time)) / 1.25
    } else {
      const envelope = Math.min(1, time / 0.005) * Math.exp(-time * 5) * (1 - phase) ** 2
      samples[index] = 0.42 * envelope * (Math.sin(2 * Math.PI * 880 * time) + 0.4 * Math.sin(2 * Math.PI * 1320 * time)) / 1.4
    }
  }
  return { sampleRate, durationMs: definition.durationMs, channels: [samples] }
}
