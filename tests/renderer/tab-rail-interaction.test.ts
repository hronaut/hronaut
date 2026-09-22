import { effectScope, ref } from 'vue'
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
