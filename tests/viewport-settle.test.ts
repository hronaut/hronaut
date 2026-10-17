import { describe, expect, it } from 'vitest'
import { VIEWPORT_RESET_SETTLE_MS, settledViewportSize, type PageViewportSize, type ViewportSettleClock } from '../src/main/browser/viewport-settle.js'

const size = (width: number, height: number): PageViewportSize => ({ width, height, devicePixelRatio: 1 })

function fakeClock(): ViewportSettleClock & { waits: number[] } {
  let time = 0
  const waits: number[] = []
  return {
    waits,
    now: () => time,
    wait: async (ms) => { waits.push(ms); time += ms }
  }
}

function reads(...sizes: PageViewportSize[]): { read: () => Promise<PageViewportSize>; count: () => number } {
  let index = 0
  return {
    read: async () => sizes[Math.min(index++, sizes.length - 1)]!,
    count: () => index
  }
}

describe('viewport size after a reset', () => {
  it('returns the first read when the page already fills its view', async () => {
    const clock = fakeClock()
    const page = reads(size(1380, 886))
    expect(await settledViewportSize(page.read, () => ({ width: 1380, height: 886 }), clock)).toEqual(size(1380, 886))
    expect(page.count()).toBe(1)
    expect(clock.waits).toEqual([])
  })

  it('reads again until the page takes its view size after a framed viewport goes', async () => {
    // A busy CI runner returned the framed 600 × 360 to the agent although the view already filled 1380 × 886.
    const clock = fakeClock()
    const page = reads(size(600, 360), size(600, 360), size(1380, 886))
    expect(await settledViewportSize(page.read, () => ({ width: 1380, height: 886 }), clock)).toEqual(size(1380, 886))
    expect(page.count()).toBe(3)
  })

  it('accepts a CSS pixel of rounding from page zoom', async () => {
    const page = reads(size(1103, 709))
    expect(await settledViewportSize(page.read, () => ({ width: 1380 / 1.25, height: 886 / 1.25 }), fakeClock())).toEqual(size(1103, 709))
    expect(page.count()).toBe(1)
  })

  it('returns the last read once the wait runs out', async () => {
    const clock = fakeClock()
    const page = reads(size(600, 360))
    expect(await settledViewportSize(page.read, () => ({ width: 1380, height: 886 }), clock)).toEqual(size(600, 360))
    expect(clock.now()).toBeGreaterThanOrEqual(VIEWPORT_RESET_SETTLE_MS)
    expect(clock.now()).toBeLessThan(VIEWPORT_RESET_SETTLE_MS + 100)
  })

  it('stops waiting when the view goes away', async () => {
    const clock = fakeClock()
    const page = reads(size(600, 360))
    expect(await settledViewportSize(page.read, () => null, clock)).toEqual(size(600, 360))
    expect(clock.waits).toEqual([])
  })
})
