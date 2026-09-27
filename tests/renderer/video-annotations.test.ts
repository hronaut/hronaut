import { expect, it, vi } from 'vitest'
import { drawVideoAnnotations, videoAnnotationOpacity } from '../../src/renderer/src/video/draw.js'
import { layoutVideoText, wrapVideoText } from '../../src/renderer/src/video/layout.js'
import { VIDEO_PLACEMENTS, videoAnnotationSchema } from '../../src/shared/video.js'

function canvas() {
  const context = {
    canvas: { width: 1280, height: 720 },
    save: vi.fn(), restore: vi.fn(), beginPath: vi.fn(), closePath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), quadraticCurveTo: vi.fn(), arc: vi.fn(),
    roundRect: vi.fn(), rect: vi.fn(), clip: vi.fn(), fill: vi.fn(), stroke: vi.fn(),
    fillRect: vi.fn(), strokeRect: vi.fn(), translate: vi.fn(), setLineDash: vi.fn(),
    fillText: vi.fn<(text: string, x: number, y: number) => void>(), measureText: (text: string) => ({ width: [...text].length * 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 })
  }
  return { context: context as unknown as CanvasRenderingContext2D, calls: context }
}

it('wraps captions at words instead of cutting words between lines', () => {
  const { context, calls } = canvas()
  const text = 'Create a workspace and invite your teammates before publishing your first project.'
  drawVideoAnnotations(context, [videoAnnotationSchema.parse({ kind: 'text', text, x: 0.75, y: 0.1, startMs: 0, endMs: 3000 })], 1000, 600, 360)
  expect(calls.fillText.mock.calls.map(call => call[0]).join(' ')).toBe(text)
})

it('preserves explicit line breaks and only splits overlong words', () => {
  expect(wrapVideoText('One two\nthreefour', 5, text => [...text].length)).toEqual(['One', 'two', 'three', 'four'])
})

it('keeps long cards within safe margins at every anchor and in portrait and landscape video', () => {
  const { context } = canvas()
  for (const [width, height] of [[1280, 720], [320, 180], [360, 640]]) {
    for (const placement of VIDEO_PLACEMENTS) {
      const annotation = videoAnnotationSchema.parse({ kind: 'callout', text: 'A long but readable instruction for the next step. '.repeat(4), title: 'Set up the project', step: 2, x: 0.98, y: 0.98, endX: 0.7, endY: 0.5, startMs: 0, endMs: 1000, placement })
      const box = layoutVideoText(context, annotation, width, height)
      expect(box.x).toBeGreaterThan(0)
      expect(box.y).toBeGreaterThan(0)
      expect(box.x + box.width).toBeLessThan(width)
      expect(box.y + box.height).toBeLessThan(height)
      expect(box.lines.every(line => context.measureText(line).width <= box.width - box.padding * 2)).toBe(true)
    }
  }
})

it('honors custom caption coordinates and places automatic callouts opposite their targets', () => {
  const { context } = canvas()
  const caption = videoAnnotationSchema.parse({ kind: 'text', text: 'Ready', startMs: 0, endMs: 1000, placement: 'custom', x: 0.2, y: 0.3 })
  expect(layoutVideoText(context, caption, 1280, 720)).toMatchObject({ x: 256, y: 216 })
  const callout = videoAnnotationSchema.parse({ kind: 'callout', text: 'Choose this control', startMs: 0, endMs: 1000, endX: 0.8, endY: 0.5 })
  const left = layoutVideoText(context, callout, 1280, 720)
  expect(left.x + left.width).toBeLessThan(1280 * 0.8)
  const right = layoutVideoText(context, { ...callout, endX: 0.2 }, 1280, 720)
  expect(right.x).toBeGreaterThan(1280 * 0.2)
})

it('uses bounded entrances and exits without leaking annotations outside their source interval', () => {
  const a = videoAnnotationSchema.parse({ kind: 'text', text: 'Next', startMs: 100, endMs: 1100 })
  expect(videoAnnotationOpacity(a, 99)).toBe(0)
  expect(videoAnnotationOpacity(a, 100)).toBe(0)
  expect(videoAnnotationOpacity(a, 150)).toBeGreaterThan(0)
  expect(videoAnnotationOpacity(a, 150)).toBeLessThan(1)
  expect(videoAnnotationOpacity(a, 600)).toBe(1)
  expect(videoAnnotationOpacity(a, 1090)).toBeLessThan(1)
  expect(videoAnnotationOpacity(a, 1100)).toBe(0)
  expect(videoAnnotationOpacity({ ...a, animation: 'none' }, 100)).toBe(1)
})

it('validates positioned captions, callout targets and non-empty spotlight regions', () => {
  const base = { startMs: 0, endMs: 1000 }
  expect(videoAnnotationSchema.parse({ ...base, kind: 'text', text: 'Ready', placement: 'top-center', width: 0.4 }).x).toBeUndefined()
  expect(() => videoAnnotationSchema.parse({ ...base, kind: 'text', text: 'Ready', placement: 'custom' })).toThrow()
  expect(() => videoAnnotationSchema.parse({ ...base, kind: 'text', text: 'Ready', width: 5 })).toThrow()
  expect(() => videoAnnotationSchema.parse({ ...base, kind: 'callout', text: 'Next', step: 1 })).toThrow()
  expect(() => videoAnnotationSchema.parse({ ...base, kind: 'spotlight', x: 0.1, y: 0.2, endX: 0.1, endY: 0.5 })).toThrow()
})

it('aligns text independently of card position and vertically centers a heading beside its badge', () => {
  const { context, calls } = canvas()
  const a = videoAnnotationSchema.parse({ kind: 'callout', title: 'NEXT STEP', step: 2, text: 'Short line\nAnother line', align: 'right', placement: 'center-left', startMs: 0, endMs: 1000, endX: 0.8, endY: 0.5 })
  const box = layoutVideoText(context, a, 1280, 720)
  drawVideoAnnotations(context, [a], 500, 1280, 720)
  const badge = calls.fillText.mock.calls.find(([text]) => text === '2')!
  const heading = calls.fillText.mock.calls.find(([text]) => text === 'NEXT STEP')!
  expect(heading[2]).toBeCloseTo(badge[2])
  const body = calls.fillText.mock.calls.filter(([text]) => text === 'Short line' || text === 'Another line')
  expect(body.map(call => call[1])).toEqual([box.x + box.width - box.padding, box.x + box.width - box.padding])
  expect(body[1][2] - body[0][2]).toBeCloseTo(box.lineHeight)
  expect(context.textBaseline).toBe('alphabetic')
  expect(context.textAlign).toBe('right')
})
