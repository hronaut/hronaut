import type { VideoCamera, VideoClip } from '../../../shared/video.js'

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(value, high))
const smooth = (value: number): number => {
  const bounded = clamp(value, 0, 1)
  return bounded * bounded * (3 - 2 * bounded)
}

/** Normalized source crop origin; its width and height are both 1 / zoom. */
export interface VideoCameraTransform { x: number; y: number; zoom: number }

/** Source timestamps alone determine motion, including a smooth return to the full frame. */
export function videoCameraAt(cameras: readonly VideoCamera[] | undefined, sourceMs: number): VideoCameraTransform {
  const camera = cameras?.find(value => sourceMs >= value.startMs && sourceMs < value.endMs)
  if (!camera) return { x: 0, y: 0, zoom: 1 }
  const durationMs = camera.endMs - camera.startMs
  const elapsedMs = sourceMs - camera.startMs
  const progress = smooth(elapsedMs / durationMs)
  const easeMs = Math.min(camera.easeMs, durationMs / 2)
  const weight = easeMs > 0 ? smooth(Math.min(elapsedMs, durationMs - elapsedMs) / easeMs) : 1
  const targetZoom = camera.zoom + ((camera.endZoom ?? camera.zoom) - camera.zoom) * progress
  const zoom = 1 + (targetZoom - 1) * weight
  const half = 0.5 / zoom
  const center = (start: number, end: number | undefined): number => {
    const target = start + ((end ?? start) - start) * progress
    return clamp(0.5 + (target - 0.5) * weight, half, 1 - half)
  }
  return { x: center(camera.x, camera.endX) - half, y: center(camera.y, camera.endY) - half, zoom }
}

/** Keep page-anchored effects on their source pixels without enlarging caption cards. */
export function videoCameraPoint(x: number, y: number, camera: VideoCameraTransform): { x: number; y: number } {
  return { x: (x - camera.x) * camera.zoom, y: (y - camera.y) * camera.zoom }
}

/**
 * Fade the completed frame through black at output clip cuts, without changing duration.
 * Each symmetric half is bounded by a quarter of either adjacent clip so fades never
 * overlap and even short clips retain a clear middle. There are no outer edge fades.
 */
export function videoTransitionOpacity(clips: readonly VideoClip[], transition: { durationMs: number } | undefined, outputMs: number): number {
  if (!transition || transition.durationMs <= 0) return 0
  let boundaryMs = 0
  for (let index = 0; index < clips.length - 1; index++) {
    const beforeMs = clips[index]!.endMs - clips[index]!.startMs
    const afterMs = clips[index + 1]!.endMs - clips[index + 1]!.startMs
    boundaryMs += beforeMs
    const halfMs = Math.min(transition.durationMs / 2, beforeMs / 4, afterMs / 4)
    const distanceMs = Math.abs(outputMs - boundaryMs)
    if (halfMs > 0 && distanceMs < halfMs) return smooth(1 - distanceMs / halfMs)
  }
  return 0
}
