import { AudioBufferSource, BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny'
import { VIDEO_LIMITS, videoFrameTiming, type VideoRenderPlan } from '../../../shared/video.js'
import { drawVideoAnnotations } from './draw.js'
import { ensureVideoAudioEncoding, mixVideoAudio } from './audio.js'
import { videoCameraAt, videoTransitionOpacity } from './motion.js'

let plan: VideoRenderPlan
let canvas: HTMLCanvasElement
let context: CanvasRenderingContext2D
let output: Output<WebMOutputFormat, BufferTarget>
let source: CanvasSource
let image: HTMLImageElement | undefined
// 30 frames a second of 720p need about twice the bits per second of the earlier 12 to keep text sharp in motion.
const BITRATE = 6_000_000
const api = {
  async begin(value: VideoRenderPlan, assets: { id: string; base64: string }[] = []): Promise<void> {
    plan = value
    image = undefined
    canvas = document.createElement('canvas')
    canvas.width = value.width; canvas.height = value.height
    context = canvas.getContext('2d', { alpha: false })!
    if (!context || !await canEncodeVideo('vp9', { width: value.width, height: value.height, bitrate: BITRATE })) throw new Error('VP9 encoding is unavailable')
    output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
    source = new CanvasSource(canvas, { codec: 'vp9', bitrate: BITRATE, keyFrameInterval: 2 })
    output.addVideoTrack(source, { frameRate: videoFrameTiming(value.clips).frameRate })
    let audioSource: AudioBufferSource | undefined
    let mixed: AudioBuffer | undefined
    if (value.audio?.length) {
      await ensureVideoAudioEncoding()
      mixed = await mixVideoAudio(value.audio, assets.map(asset => ({ id: asset.id, data: Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0)) })), videoFrameTiming(value.clips).durationMs)
      audioSource = new AudioBufferSource({ codec: 'opus', bitrate: 128_000 })
      output.addAudioTrack(audioSource)
    }
    await output.start()
    if (audioSource && mixed) { await audioSource.add(mixed); audioSource.close() }
  },
  async frame(dataUrl: string | null, sourceMs: number, outputMs: number, durationMs: number): Promise<void> {
    // Without a new image, the frame repeats the last one.
    if (dataUrl !== null) {
      const next = new Image()
      next.src = dataUrl
      await next.decode()
      image = next
    }
    if (!image) throw new Error('The first video frame needs an image')
    context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height)
    const camera = videoCameraAt(plan.cameras, sourceMs)
    context.drawImage(image, camera.x * image.naturalWidth, camera.y * image.naturalHeight, image.naturalWidth / camera.zoom, image.naturalHeight / camera.zoom, 0, 0, canvas.width, canvas.height)
    drawVideoAnnotations(context, plan.annotations, sourceMs, canvas.width, canvas.height, camera)
    const opacity = videoTransitionOpacity(plan.clips, plan.transition, outputMs)
    if (opacity > 0) {
      context.save(); context.globalAlpha = opacity; context.fillStyle = '#000000'
      context.fillRect(0, 0, canvas.width, canvas.height); context.restore()
    }
    await source.add(outputMs / 1000, durationMs / 1000)
  },
  async finish(): Promise<string> {
    source.close()
    await output.finalize()
    if (!output.target.buffer || output.target.buffer.byteLength > VIDEO_LIMITS.bytes) throw new Error('Video export exceeded its size limit')
    const blob = new Blob([output.target.buffer], { type: 'video/webm' })
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('Could not read exported video'))
      reader.readAsDataURL(blob)
    })
  }
}
Object.assign(window, { hronautVideoExport: api })
