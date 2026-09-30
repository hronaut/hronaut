import { AudioBufferSource, BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny'
import { videoFrameTiming, type VideoRenderPlan } from '../../../shared/video.js'
import { drawVideoAnnotations } from './draw.js'
import { ensureVideoAudioEncoding, mixVideoAudio } from './audio.js'
import { videoCameraAt, videoTransitionOpacity } from './motion.js'

let plan: VideoRenderPlan
let canvas: HTMLCanvasElement
let context: CanvasRenderingContext2D
let output: Output<WebMOutputFormat, BufferTarget>
let source: CanvasSource
const api = {
  async begin(value: VideoRenderPlan, assets: { id: string; base64: string }[] = []): Promise<void> {
    plan = value
    canvas = document.createElement('canvas')
    canvas.width = value.width; canvas.height = value.height
    context = canvas.getContext('2d', { alpha: false })!
    if (!context || !await canEncodeVideo('vp9', { width: value.width, height: value.height, bitrate: 3_000_000 })) throw new Error('VP9 encoding is unavailable')
    output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
    source = new CanvasSource(canvas, { codec: 'vp9', bitrate: 3_000_000, keyFrameInterval: 2 })
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
  async frame(dataUrl: string, sourceMs: number, outputMs: number, durationMs: number): Promise<void> {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
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
    if (!output.target.buffer || output.target.buffer.byteLength > 64 * 1024 * 1024) throw new Error('Video export exceeded its size limit')
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
