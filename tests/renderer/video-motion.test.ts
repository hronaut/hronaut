import { expect, it, vi } from 'vitest'
import { drawVideoAnnotations } from '../../src/renderer/src/video/draw.js'
import { videoCameraAt, videoCameraPoint, videoTransitionOpacity } from '../../src/renderer/src/video/motion.js'
import { videoAnnotationSchema, videoCameraSchema } from '../../src/shared/video.js'

const camera = (values = {}) => videoCameraSchema.parse({ startMs: 100, endMs: 2100, x: 0.5, y: 0.5, zoom: 2, easeMs: 300, ...values })

it('returns the full frame outside camera intervals and at eased boundaries', () => {
  const cameras = [camera()]
  for (const time of [0, 99, 100, 2100, 3000]) expect(videoCameraAt(cameras, time)).toEqual({ x: 0, y: 0, zoom: 1 })
  expect(videoCameraAt(undefined, 1100)).toEqual({ x: 0, y: 0, zoom: 1 })
  expect(videoCameraAt([], 1100)).toEqual({ x: 0, y: 0, zoom: 1 })
  expect(videoCameraAt(cameras, 1100)).toEqual({ x: 0.25, y: 0.25, zoom: 2 })
})

it('eases zoom in and out symmetrically and bounds easing for short intervals', () => {
  const cameras = [camera({ zoom: 3 })]
  expect(videoCameraAt(cameras, 250)).toEqual({ x: 0.25, y: 0.25, zoom: 2 })
  expect(videoCameraAt(cameras, 1950)).toEqual(videoCameraAt(cameras, 250))
  expect(videoCameraAt(cameras, 101).zoom).toBeLessThan(1.001)
  expect(videoCameraAt(cameras, 2099).zoom).toBeLessThan(1.001)
  const short = [camera({ endMs: 200, zoom: 3 })]
  expect(videoCameraAt(short, 150).zoom).toBe(3)
  expect(videoCameraAt(short, 125).zoom).toBe(2)
  expect(videoCameraAt(short, 175).zoom).toBe(2)
})

it('pans and changes zoom deterministically using source time', () => {
  const cameras = [camera({ startMs: 0, endMs: 1000, x: 0.25, endX: 0.75, zoom: 2, endZoom: 3, easeMs: 0 })]
  const midpoint = videoCameraAt(cameras, 500)
  expect(midpoint).toEqual({ x: 0.3, y: 0.3, zoom: 2.5 })
  expect(videoCameraPoint(0.5, 0.5, midpoint)).toEqual({ x: 0.5, y: 0.5 })
  expect(videoCameraAt(cameras, 0)).toEqual({ x: 0, y: 0.25, zoom: 2 })
  expect(videoCameraAt(cameras, 250).x).toBeLessThan(midpoint.x)
  expect(videoCameraAt(cameras, 750).x).toBeGreaterThan(midpoint.x)
  // Repeated and out-of-order frame requests do not retain animation state.
  expect(videoCameraAt(cameras, 500)).toEqual(midpoint)
})

it('clamps the complete crop inside footage, including extreme centers during easing', () => {
  for (const x of [0, 0.1, 0.5, 0.9, 1]) {
    for (const y of [0, 0.5, 1]) {
      const cameras = [camera({ x, y, endX: 1 - x, endY: 1 - y, zoom: 3, endZoom: 1 })]
      for (let time = 100; time <= 2100; time += 25) {
        const view = videoCameraAt(cameras, time)
        expect(view.x).toBeGreaterThanOrEqual(0)
        expect(view.y).toBeGreaterThanOrEqual(0)
        expect(view.x + 1 / view.zoom).toBeLessThanOrEqual(1 + Number.EPSILON)
        expect(view.y + 1 / view.zoom).toBeLessThanOrEqual(1 + Number.EPSILON)
        expect(view.zoom).toBeGreaterThanOrEqual(1)
        expect(view.zoom).toBeLessThanOrEqual(3)
      }
    }
  }
  expect(videoCameraAt([camera({ x: 0, y: 1, zoom: 2 })], 1100)).toEqual({ x: 0, y: 0.5, zoom: 2 })
  expect(videoCameraAt([camera({ x: 0, y: 1, zoom: 1 })], 1100)).toEqual({ x: 0, y: 0, zoom: 1 })
})

it('fades through black at output cuts without fading the recording edges', () => {
  const clips = [{ startMs: 100, endMs: 1100 }, { startMs: 1500, endMs: 2500 }, { startMs: 3000, endMs: 4000 }]
  const transition = { durationMs: 400 }
  for (const boundary of [1000, 2000]) {
    expect(videoTransitionOpacity(clips, transition, boundary - 200)).toBe(0)
    expect(videoTransitionOpacity(clips, transition, boundary - 100)).toBe(0.5)
    expect(videoTransitionOpacity(clips, transition, boundary)).toBe(1)
    expect(videoTransitionOpacity(clips, transition, boundary + 100)).toBe(0.5)
    expect(videoTransitionOpacity(clips, transition, boundary + 200)).toBe(0)
  }
  for (const time of [0, 300, 1500, 2900, 3000]) expect(videoTransitionOpacity(clips, transition, time)).toBe(0)
  expect(videoTransitionOpacity(clips, undefined, 1000)).toBe(0)
  expect(videoTransitionOpacity(clips, { durationMs: 0 }, 1000)).toBe(0)
  expect(videoTransitionOpacity([clips[0]], transition, 500)).toBe(0)
  expect(videoTransitionOpacity([], transition, 500)).toBe(0)
})

it('keeps transition halves disjoint and preserves a clear middle on very short clips', () => {
  const clips = [{ startMs: 0, endMs: 1000 }, { startMs: 1200, endMs: 1300 }, { startMs: 1500, endMs: 2500 }]
  const transition = { durationMs: 1000 }
  expect(videoTransitionOpacity(clips, transition, 987.5)).toBe(0.5)
  expect(videoTransitionOpacity(clips, transition, 1000)).toBe(1)
  expect(videoTransitionOpacity(clips, transition, 1100)).toBe(1)
  for (const time of [1025, 1050, 1075]) expect(videoTransitionOpacity(clips, transition, time)).toBe(0)
})

function canvas() {
  const calls = {
    canvas: { width: 1280, height: 720 },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), arc: vi.fn(),
    roundRect: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), translate: vi.fn(), setLineDash: vi.fn(),
    fillText: vi.fn<(text: string, x: number, y: number) => void>(), measureText: (text: string) => ({ width: [...text].length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
  }
  return { context: calls as unknown as CanvasRenderingContext2D, calls }
}

it.each(['text', 'callout'] as const)('keeps %s card placement and text size stable during camera motion', kind => {
  const annotation = videoAnnotationSchema.parse({ kind, text: 'Keep this readable', endX: 0.6, endY: 0.55, startMs: 0, endMs: 1000, animation: 'none' })
  const still = canvas(), moved = canvas()
  drawVideoAnnotations(still.context, [annotation], 500, 1280, 720)
  // The transformed callout target crosses the center; its card must not switch sides.
  drawVideoAnnotations(moved.context, [annotation], 500, 1280, 720, { x: 0.5, y: 0.2, zoom: 2 })
  expect(moved.calls.fillText.mock.calls).toEqual(still.calls.fillText.mock.calls)
  expect(moved.calls.roundRect.mock.calls).toEqual(still.calls.roundRect.mock.calls)
  expect(moved.context.font).toEqual(still.context.font)
  if (kind === 'callout') {
    const tip = moved.calls.quadraticCurveTo.mock.calls[0].slice(2) as number[]
    expect(tip[0]).toBeCloseTo(256)
    expect(tip[1]).toBeCloseTo(504)
  }
})

it('keeps custom caption positions in output space and source shapes on captured pixels', () => {
  const { context, calls } = canvas()
  const base = { startMs: 0, endMs: 1000, animation: 'none' }
  const annotations = [
    videoAnnotationSchema.parse({ ...base, kind: 'text', text: 'Screen anchored', placement: 'custom', x: 0.1, y: 0.2 }),
    videoAnnotationSchema.parse({ ...base, kind: 'click', x: 0.6, y: 0.5 }),
    videoAnnotationSchema.parse({ ...base, kind: 'highlight', x: 0.4, y: 0.4, endX: 0.6, endY: 0.6 }),
    videoAnnotationSchema.parse({ ...base, kind: 'spotlight', x: 0.4, y: 0.4, endX: 0.6, endY: 0.6 })
  ]
  const before = structuredClone(annotations)
  drawVideoAnnotations(context, annotations, 500, 1280, 720, { x: 0.25, y: 0.25, zoom: 2 })
  expect(calls.arc.mock.calls[0][0]).toBeCloseTo(896)
  expect(calls.arc.mock.calls[0][1]).toBeCloseTo(360)
  expect(calls.arc.mock.calls[0][2]).toBe(20)
  const sourceRegion = calls.roundRect.mock.calls[0]
  expect(sourceRegion[0]).toBeCloseTo(384)
  expect(sourceRegion[1]).toBeCloseTo(216)
  expect(sourceRegion[2]).toBeCloseTo(512)
  expect(sourceRegion[3]).toBeCloseTo(288)
  const card = calls.roundRect.mock.calls.at(-2)!
  expect(card.slice(0, 2)).toEqual([128, 144])
  expect(annotations).toEqual(before)
})
