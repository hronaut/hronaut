import { describe, expect, it, vi } from 'vitest'

// Zoom went through 50, 60, 67, … 400%, where Chrome goes through 25, 33, 50, 67, … 500%: Hronaut stopped short at
// both ends and had a 60% step that Chrome does not.

vi.mock('../src/main/browser/browser-state/browser-state.js', () => ({ browserState: () => ({}), publishChange: () => undefined }))
const { setZoom } = await import('../src/main/browser/page-zoom/page-zoom.js')

const CHROME_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500]

/** A page whose zoom reads back as Chromium gives it, through its zoom level: 5 as 4.999999999999999, 1/3 as 0.3333333333333332. */
function page(percent: number) {
  let level = Math.log(percent / 100) / Math.log(1.2)
  const factor = () => 1.2 ** level
  const set: number[] = []
  const browser = {
    activeTabId: 'site',
    tabs: new Map([['site', {
      id: 'site',
      nativeInputEnvironmentGeneration: 0,
      webContents: { getZoomFactor: factor, setZoomFactor: (next: number) => { set.push(next); level = Math.log(next) / Math.log(1.2) } }
    }]])
  }
  return { browser: browser as never, percent: () => Math.round(factor() * 100), set }
}

describe('page zoom steps', () => {
  it('zooms in through Chrome\'s steps from 25% to 500%, and out back again', () => {
    const zoomed = page(25)
    const seen = [zoomed.percent()]
    for (let step = 1; step < CHROME_STEPS.length + 2; step += 1) {
      setZoom(zoomed.browser, { action: 'in' })
      seen.push(zoomed.percent())
    }
    expect(seen).toEqual([...CHROME_STEPS, 500, 500])
    const back = [zoomed.percent()]
    for (let step = 1; step < CHROME_STEPS.length + 1; step += 1) {
      setZoom(zoomed.browser, { action: 'out' })
      back.push(zoomed.percent())
    }
    expect(back).toEqual([...CHROME_STEPS].reverse().concat(25))
  })

  it('zooms to Chrome\'s exact third and two thirds at 33% and 67%', () => {
    const zoomed = page(50)
    setZoom(zoomed.browser, { action: 'out' })
    setZoom(zoomed.browser, { action: 'set', percent: 67 })
    expect(zoomed.set).toEqual([1 / 3, 2 / 3])
    expect(zoomed.percent()).toBe(67)
  })

  it('moves from a zoom between steps to the nearest step on that side', () => {
    const zoomed = page(60)
    setZoom(zoomed.browser, { action: 'in' })
    expect(zoomed.percent()).toBe(67)
    setZoom(zoomed.browser, { action: 'set', percent: 60 })
    setZoom(zoomed.browser, { action: 'out' })
    expect(zoomed.percent()).toBe(50)
  })

  it('sets any whole percent from 25 to 500, and nothing outside it', () => {
    const zoomed = page(100)
    for (const percent of [25, 500]) {
      setZoom(zoomed.browser, { action: 'set', percent })
      expect(zoomed.percent()).toBe(percent)
    }
    for (const percent of [24, 501, 33.5]) {
      expect(() => setZoom(zoomed.browser, { action: 'set', percent })).toThrow('Page zoom percent must be an integer from 25 to 500')
    }
    expect(zoomed.percent()).toBe(500)
  })
})
