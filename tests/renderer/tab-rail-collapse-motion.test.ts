import { effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useTabRailCollapseMotion } from '../../src/renderer/src/composables/useTabRailCollapseMotion.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

function harness() {
  let now = 0
  let nextId = 0
  const frames = new Map<number, FrameRequestCallback>()
  const media = new EventTarget() as MediaQueryList
  Object.defineProperty(media, 'matches', { value: false, writable: true })
  vi.stubGlobal('matchMedia', () => media)
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++nextId, callback); return nextId })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id) })
  const collapsed = ref(false)
  const expandedWidth = ref(320)
  const animate = ref(true)
  const viewportWidth = ref(1200)
  const scope = effectScope()
  const motion = scope.run(() => useTabRailCollapseMotion({ collapsed, expandedWidth, animate, viewportWidth }))!
  const tick = (milliseconds: number, frameTimestamp = now + milliseconds) => {
    now += milliseconds
    const queued = [...frames.values()]
    frames.clear()
    queued.forEach(callback => callback(frameTimestamp))
  }
  const reduce = () => { Object.assign(media, { matches: true }); media.dispatchEvent(new Event('change')) }
  const dispose = () => { scope.stop(); vi.unstubAllGlobals() }
  return { collapsed, expandedWidth, animate, viewportWidth, motion, tick, reduce, dispose, frames }
}

describe('workspace rail collapse motion', () => {
  it('shrinks continuously and finishes at the compact width after140ms', () => {
    const h = harness()
    h.collapsed.value = true
    expect(h.motion.collapsing.value).toBe(true)
    expect(h.motion.width.value).toBe(320)
    h.tick(70)
    expect(h.motion.width.value).toBeGreaterThan(56)
    expect(h.motion.width.value).toBeLessThan(320)
    h.tick(70)
    expect(h.motion.width.value).toBe(56)
    expect(h.motion.collapsing.value).toBe(false)
    expect(h.frames.size).toBe(0)
    h.dispose()
  })

  it('never expands past its starting width when the first frame timestamp precedes the start clock', () => {
    const h = harness()
    try {
      h.collapsed.value = true
      const widths = [h.motion.width.value]
      // RAF timestamps describe the rendering frame, which can begin before
      // performance.now() sampled when the collapse starts within that frame.
      h.tick(10, -10)
      widths.push(h.motion.width.value)
      expect(h.motion.width.value).toBe(320)
      h.tick(10, 0)
      widths.push(h.motion.width.value)
      h.tick(60, 70)
      widths.push(h.motion.width.value)
      h.tick(70, 140)
      widths.push(h.motion.width.value)
      expect(widths.every((width, index) => width >= 56 && width <= (widths[index - 1] ?? 320))).toBe(true)
      expect(h.motion.width.value).toBe(56)
      expect(h.motion.collapsing.value).toBe(false)
    } finally { h.dispose() }
  })

  it('cancels cleanly on rapid reveal then hide without a stale frame snapping closed', () => {
    const h = harness()
    h.collapsed.value = true
    h.tick(40)
    h.collapsed.value = false
    expect(h.motion.width.value).toBe(320)
    expect(h.motion.collapsing.value).toBe(false)
    expect(h.frames.size).toBe(0)
    h.collapsed.value = true
    h.tick(140)
    expect(h.motion.width.value).toBe(56)
    h.collapsed.value = false
    h.expandedWidth.value = 400
    expect(h.motion.width.value).toBe(400)
    expect(h.frames.size).toBe(0)
    h.dispose()
  })

  it.each(['reduced motion', 'manual resize or compact overlay', 'viewport resize', 'width change'])('settles immediately for %s', reason => {
    const h = harness()
    h.collapsed.value = true
    h.tick(30)
    if (reason === 'reduced motion') h.reduce()
    else if (reason === 'manual resize or compact overlay') h.animate.value = false
    else if (reason === 'viewport resize') h.viewportWidth.value = 1100
    else h.expandedWidth.value = 400
    expect(h.motion.width.value).toBe(56)
    expect(h.motion.collapsing.value).toBe(false)
    expect(h.frames.size).toBe(0)
    h.dispose()
  })

  it('removes pending animation frames when its owner is disposed', () => {
    const h = harness()
    h.collapsed.value = true
    h.dispose()
    expect(h.frames.size).toBe(0)
    expect(h.motion.collapsing.value).toBe(false)
  })
})
