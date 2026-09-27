import { BufferTarget, CanvasSource, Output, WebMOutputFormat, canEncodeVideo } from 'mediabunny'
import { videoFrameTiming, type VideoRenderPlan } from '../../../shared/video.js'
import { drawVideoAnnotations } from './draw.js'

let plan: VideoRenderPlan
let canvas: HTMLCanvasElement
let context: CanvasRenderingContext2D
let output: Output<WebMOutputFormat, BufferTarget>
let source: CanvasSource
const api = {
  async begin(value: VideoRenderPlan): Promise<void> {
    plan = value
    canvas = document.createElement('canvas')
    canvas.width = value.width; canvas.height = value.height
    context = canvas.getContext('2d', { alpha: false })!
    if (!context || !await canEncodeVideo('vp9', { width: value.width, height: value.height, bitrate: 3_000_000 })) throw new Error('VP9 encoding is unavailable')
    output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
    source = new CanvasSource(canvas, { codec: 'vp9', bitrate: 3_000_000, keyFrameInterval: 2 })
    output.addVideoTrack(source, { frameRate: videoFrameTiming(value.clips).frameRate })
    await output.start()
  },
  async frame(dataUrl: string, sourceMs: number, outputMs: number, durationMs: number): Promise<void> {
    const image = new Image()
    image.src = dataUrl
    await image.decode()
    context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    drawVideoAnnotations(context, plan.annotations, sourceMs, canvas.width, canvas.height)
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
