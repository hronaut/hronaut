import { effectScope, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RENDERER_SETTINGS } from '../../src/renderer/src/stores/settings.js'
import type { AppSettings } from '../../src/shared/types.js'
import { useAppearancePresentationController } from '../../src/renderer/src/composables/useAppearancePresentationController.js'

vi.mock('@foleyjs/core', () => ({ play: vi.fn(), set: vi.fn() }))

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); window.localStorage.clear(); document.body.replaceChildren() })

function harness() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  window.localStorage.setItem('hronaut:vertical-tab-rail-pinned', 'false')
  const scope = effectScope()
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS, tabPosition: 'left' })
  const controller = scope.run(() => useAppearancePresentationController({
    settings,
    systemTheme: ref('light'), detachedWindow: false
  }))!
  const shell = document.createElement('header')
  shell.className = 'shell'
  const rail = document.createElement('nav')
  const control = document.createElement('button')
  const outside = document.createElement('input')
  rail.append(control)
  shell.append(rail, outside)
  document.body.append(shell)
  rail.addEventListener('mouseenter', controller.revealVerticalTabRail)
  rail.addEventListener('mouseleave', controller.concealVerticalTabRail)
  rail.addEventListener('focusin', controller.revealVerticalTabRail)
  rail.addEventListener('focusout', controller.handleVerticalTabRailFocusOut)
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  return { controller, settings, rail, control, outside, dispose: () => scope.stop() }
}

describe('tab rail interaction', () => {
  it('keeps the rail open when focus leaves but the pointer is still using it', () => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(250)
      h.control.focus()
      h.outside.focus()
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
    } finally { h.dispose() }
  })

  it('does not open for a brief pointer crossing', () => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(80)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('gives pointer exits a grace period and cancels closure on reentry', () => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(200)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(100)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(400)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(300)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
    } finally { h.dispose() }
  })

  it('reveals keyboard focus immediately and keeps it open after pointer exit', () => {
    const h = harness()
    try {
      h.control.focus()
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.outside.focus()
      vi.advanceTimersByTime(300)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
    } finally { h.dispose() }
  })

  it.each([0, 1, 2])('keeps a collapsed pointer target stable through button %i activation', button => {
    const h = harness()
    try {
      h.outside.focus()
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      h.control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, isPrimary: true, button }))
      h.control.focus()
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
      h.control.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4, button }))
      const widths: number[] = []
      h.control.addEventListener('click', () => widths.push(h.controller.tabRailWidth.value))
      h.control.click()
      expect(widths).toEqual([56])
      vi.advanceTimersByTime(1)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
    } finally { h.dispose() }
  })

  it('keeps drag targets in place until the drag finishes', () => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(200)
      h.control.dispatchEvent(new Event('dragstart', { bubbles: true }))
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(false)
      h.control.dispatchEvent(new Event('dragend', { bubbles: true }))
      vi.advanceTimersByTime(300)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
    } finally { h.dispose() }
  })

  it.each(['blur', 'orientation', 'dispose'])('cancels a pending reveal on %s', reason => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      if (reason === 'blur') window.dispatchEvent(new Event('blur'))
      else if (reason === 'orientation') h.settings.value.tabPosition = 'top'
      else h.dispose()
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailRevealed.value).toBe(false)
    } finally { h.dispose() }
  })
})

// With the rail collapsed when not in use and main able to draw it, the pointer opens the rail over the page in main's
// view: the shell's own rail stays folded, so the page keeps its 56 px inset.
describe('tab rail opened over the page', () => {
  function overlayHarness() {
    const h = harness()
    h.controller.setVerticalTabRailOverlayAvailable(true)
    return h
  }

  function openOverPage(h: ReturnType<typeof harness>) {
    h.rail.dispatchEvent(new MouseEvent('mouseenter'))
    vi.advanceTimersByTime(200)
    expect(h.controller.verticalTabRailRevealed.value).toBe(true)
    expect(h.controller.verticalTabRailOverlaid.value).toBe(true)
    // Main's view shows it; the pointer is there now.
    h.controller.delegateVerticalTabRail(true)
    h.controller.setVerticalTabRailOverlayPointer({ hovered: true, held: false })
  }

  it('keeps the page inset at 56 px while the pointer opens the rail over the page', () => {
    const h = overlayHarness()
    // Not for a moment either: the page view follows every width the shell reports.
    const widths: number[] = []
    const stop = watch(h.controller.tabRailWidth, (width) => widths.push(width), { flush: 'sync' })
    try {
      openOverPage(h)
      vi.advanceTimersByTime(500)
      expect(h.controller.tabRailWidth.value).toBe(56)
      expect(h.controller.verticalTabRailCollapsed.value).toBe(true)
      expect(widths).toEqual([])
    } finally { stop(); h.dispose() }
  })

  it('opens beside the page at 280 px when main cannot draw that opening, and asks again the next time', () => {
    const h = overlayHarness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(200)
      h.controller.refuseVerticalTabRailOverlay()
      expect(h.controller.verticalTabRailOverlaid.value).toBe(false)
      vi.advanceTimersByTime(500)
      expect(h.controller.tabRailWidth.value).toBe(280)
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      vi.advanceTimersByTime(600)
      expect(h.controller.verticalTabRailRevealed.value).toBe(false)
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(200)
      expect(h.controller.verticalTabRailOverlaid.value).toBe(true)
    } finally { h.dispose() }
  })

  it('opens beside the page whenever main has no view for it', () => {
    const h = harness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      vi.advanceTimersByTime(500)
      expect(h.controller.verticalTabRailOverlaid.value).toBe(false)
      expect(h.controller.tabRailWidth.value).toBe(280)
    } finally { h.dispose() }
  })

  it('ignores the shell\'s mouseleave and window blur while main\'s view has the pointer, and closes once it leaves', () => {
    const h = overlayHarness()
    try {
      openOverPage(h)
      // The view appears under the pointer: the shell hears it leave, and focus moves to the view or the page under it.
      h.rail.dispatchEvent(new MouseEvent('mouseleave'))
      window.dispatchEvent(new Event('blur'))
      vi.advanceTimersByTime(1_000)
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      // A menu or drag in the view holds it open with the pointer outside.
      h.controller.setVerticalTabRailOverlayPointer({ hovered: false, held: true })
      vi.advanceTimersByTime(1_000)
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      h.controller.setVerticalTabRailOverlayPointer({ hovered: false, held: false })
      vi.advanceTimersByTime(100)
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      // Back in time: the grace period starts over.
      h.controller.setVerticalTabRailOverlayPointer({ hovered: true, held: false })
      vi.advanceTimersByTime(400)
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      h.controller.setVerticalTabRailOverlayPointer({ hovered: false, held: false })
      vi.advanceTimersByTime(300)
      expect(h.controller.verticalTabRailRevealed.value).toBe(false)
      expect(h.controller.tabRailWidth.value).toBe(56)
    } finally { h.dispose() }
  })

  it('opens over the page after a click on the folded rail, and hands over to the shell when the keyboard moves in', () => {
    const h = overlayHarness()
    try {
      h.rail.dispatchEvent(new MouseEvent('mouseenter'))
      h.control.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 3, isPrimary: true, button: 0 }))
      h.control.focus()
      h.control.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 3, button: 0 }))
      vi.advanceTimersByTime(1)
      expect(h.controller.verticalTabRailOverlaid.value).toBe(true)
      expect(h.controller.tabRailWidth.value).toBe(56)
      h.controller.delegateVerticalTabRail(true)
      // The pointer goes to the page, and the keyboard moves into the shell's own rail: it opens there instead.
      h.controller.setVerticalTabRailOverlayPointer({ hovered: false, held: false })
      h.outside.focus()
      h.control.focus()
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      expect(h.controller.verticalTabRailOverlaid.value).toBe(false)
      h.controller.delegateVerticalTabRail(false)
      vi.advanceTimersByTime(500)
      expect(h.controller.tabRailWidth.value).toBe(280)
    } finally { h.dispose() }
  })

  it('keeps a rail that keyboard focus opens beside the page', () => {
    const h = overlayHarness()
    try {
      h.control.focus()
      expect(h.controller.verticalTabRailRevealed.value).toBe(true)
      expect(h.controller.verticalTabRailOverlaid.value).toBe(false)
      vi.advanceTimersByTime(500)
      expect(h.controller.tabRailWidth.value).toBe(280)
    } finally { h.dispose() }
  })
})
