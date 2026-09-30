import { canEncodeAudio } from 'mediabunny'
import { VIDEO_AUDIO_BUILTINS, VIDEO_AUDIO_LIMITS, generateVideoAudioBuiltin, parseVideoAudioWav, type VideoAudioPcm } from '../../../shared/video-audio.js'
import type { VideoAudioEvent } from '../../../shared/video.js'

export interface VideoAudioRenderAsset { id: string; data: Uint8Array }
export interface VideoAudioMix extends VideoAudioPcm { gain: number; peak: number }

const blockSize = 16_384
const edgeFadeMs = 2
function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Video audio rendering was cancelled')
}
async function yieldAudio(signal?: AbortSignal): Promise<void> {
  checkCancelled(signal)
  await new Promise<void>(resolve => setTimeout(resolve, 0))
  checkCancelled(signal)
}

export async function ensureVideoAudioEncoding(): Promise<void> {
  if (!await canEncodeAudio('opus', {
    sampleRate: VIDEO_AUDIO_LIMITS.sampleRate,
    numberOfChannels: VIDEO_AUDIO_LIMITS.channels,
    bitrate: VIDEO_AUDIO_LIMITS.bitrate
  })) throw new Error('Opus audio encoding is unavailable; remove audio or use a supported Hronaut runtime')
}

/**
 * Audio uses edited output time, independently of source-time visual annotations.
 * Stereo 48 kHz linear resampling; sum first, then apply a single constant gain
 * only if needed to keep peaks at 0.95. No hard clipping, dynamic pumping or shifts.
 */
export async function mixVideoAudioPcm(events: VideoAudioEvent[], assets: VideoAudioRenderAsset[], durationMs: number, signal?: AbortSignal): Promise<VideoAudioMix> {
  checkCancelled(signal)
  if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > VIDEO_AUDIO_LIMITS.durationMs
    || events.length > VIDEO_AUDIO_LIMITS.events || assets.length > VIDEO_AUDIO_LIMITS.assets) throw new Error('Audio mix exceeds its limits')
  const imports = new Map<string, Uint8Array>()
  let totalBytes = 0
  for (const asset of assets) {
    if (!asset.id || asset.id.startsWith('builtin:') || imports.has(asset.id) || !(asset.data instanceof Uint8Array)
      || asset.data.byteLength > VIDEO_AUDIO_LIMITS.bytes) throw new Error('Invalid imported audio asset')
    totalBytes += asset.data.byteLength
    imports.set(asset.id, asset.data)
  }
  if (totalBytes > VIDEO_AUDIO_LIMITS.totalBytes) throw new Error('Imported audio exceeds its memory limit')
  const decoded = new Map<string, VideoAudioPcm>()
  const sampleRate = VIDEO_AUDIO_LIMITS.sampleRate
  const length = Math.max(1, Math.round(durationMs * sampleRate / 1000))
  const channels = [new Float32Array(length), new Float32Array(length)]
  const prepared = []
  for (const event of events) {
    if (![event.startMs, event.endMs, event.offsetMs, event.volume, event.fadeInMs, event.fadeOutMs].every(Number.isFinite)
      || event.startMs < 0 || event.endMs <= event.startMs || event.endMs > durationMs || event.offsetMs < 0
      || event.volume < 0 || event.volume > 1 || event.fadeInMs < 0 || event.fadeOutMs < 0
      || event.fadeInMs + event.fadeOutMs > event.endMs - event.startMs || typeof event.loop !== 'boolean') throw new Error('Invalid audio timing or volume')
    let pcm = decoded.get(event.assetId)
    if (!pcm) {
      const bytes = imports.get(event.assetId)
      if (bytes) pcm = parseVideoAudioWav(bytes)
      else if (VIDEO_AUDIO_BUILTINS.some(asset => asset.id === event.assetId)) pcm = generateVideoAudioBuiltin(event.assetId)
      else throw new Error('An audio asset is missing; import it again or remove its event')
      decoded.set(event.assetId, pcm)
      await yieldAudio(signal)
    }
    if (event.offsetMs >= pcm.durationMs) throw new Error('Audio offset must be inside the asset')
    const start = Math.round(event.startMs * sampleRate / 1000)
    const end = Math.min(length, Math.round(event.endMs * sampleRate / 1000))
    prepared.push({
      event, pcm, start, end,
      fadeIn: Math.max(edgeFadeMs, event.fadeInMs) * sampleRate / 1000,
      fadeOut: Math.max(edgeFadeMs, event.fadeOutMs) * sampleRate / 1000
    })
  }
  for (let blockStart = 0; blockStart < length; blockStart += blockSize) {
    const blockEnd = Math.min(length, blockStart + blockSize)
    for (const { event, pcm, start, end, fadeIn, fadeOut } of prepared) {
      if (event.volume === 0 || start >= blockEnd || end <= blockStart) continue
      const sourceLength = pcm.channels[0]!.length
      const rateRatio = pcm.sampleRate / sampleRate
      const offset = event.offsetMs * pcm.sampleRate / 1000
      const sourceEdgeFade = edgeFadeMs * pcm.sampleRate / 1000
      for (let index = Math.max(start, blockStart); index < Math.min(end, blockEnd); index++) {
        let position = offset + (index - start) * rateRatio
        if (event.loop) position %= sourceLength
        else if (position >= sourceLength) break
        const lower = Math.floor(position)
        const upper = event.loop ? (lower + 1) % sourceLength : Math.min(lower + 1, sourceLength - 1)
        const fraction = position - lower
        const envelope = Math.min(1, (index - start) / fadeIn, (end - 1 - index) / fadeOut)
          * Math.min(1, position / sourceEdgeFade, (sourceLength - 1 - position) / sourceEdgeFade)
        const gain = event.volume * Math.max(0, envelope)
        for (let channel = 0; channel < 2; channel++) {
          const input = pcm.channels[channel] ?? pcm.channels[0]!
          channels[channel]![index] = channels[channel]![index]! + (input[lower]! * (1 - fraction) + input[upper]! * fraction) * gain
        }
      }
    }
    await yieldAudio(signal)
  }
  let peak = 0
  for (let blockStart = 0; blockStart < length; blockStart += blockSize) {
    for (const channel of channels) {
      for (let index = blockStart; index < Math.min(length, blockStart + blockSize); index++) peak = Math.max(peak, Math.abs(channel[index]!))
    }
    await yieldAudio(signal)
  }
  const gain = peak > VIDEO_AUDIO_LIMITS.peak ? VIDEO_AUDIO_LIMITS.peak / peak : 1
  if (gain < 1) {
    for (let blockStart = 0; blockStart < length; blockStart += blockSize) {
      for (const channel of channels) {
        for (let index = blockStart; index < Math.min(length, blockStart + blockSize); index++) channel[index]! *= gain
      }
      await yieldAudio(signal)
    }
  }
  return { sampleRate, channels, durationMs: length * 1000 / sampleRate, gain, peak: Math.min(peak, VIDEO_AUDIO_LIMITS.peak) }
}

export async function mixVideoAudio(events: VideoAudioEvent[], assets: VideoAudioRenderAsset[], durationMs: number, signal?: AbortSignal): Promise<AudioBuffer> {
  const pcm = await mixVideoAudioPcm(events, assets, durationMs, signal)
  checkCancelled(signal)
  const buffer = new AudioBuffer({ length: pcm.channels[0]!.length, sampleRate: pcm.sampleRate, numberOfChannels: 2 })
  pcm.channels.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index))
  return buffer
}
