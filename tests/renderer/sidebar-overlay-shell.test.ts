import { effectScope, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useSidebarOverlay } from '../../src/renderer/src/composables/useSidebarOverlay.js'
import { viewportQuery, viewportQueryMatches } from '../../src/renderer/src/shell-viewport-media.js'
import type { HronautSidebarOverlayApi, SidebarOverlayEvent, SidebarOverlayModel } from '../../src/shared/sidebar-overlay.js'

afterEach(() => { vi.restoreAllMocks() })

function harness(options: { api?: boolean } = {}) {
  let listener: ((event: SidebarOverlayEvent) => void) | undefined
  const show = vi.fn<HronautSidebarOverlayApi['show']>()
  const hide = vi.fn<HronautSidebarOverlayApi['hide']>()
  const api: HronautSidebarOverlayApi = {
    show,
    hide,
    onEvent: (next) => {
      listener = next
      return () => { listener = undefined }
    }
  }
  const overlaid = ref(false)
  const width = ref(280)
  const tooLarge = ref(false)
  const callbacks = { delegate: vi.fn(), pointer: vi.fn(), refused: vi.fn(), hidden: vi.fn(), intent: vi.fn() }
  const scope = effectScope()
  const session = scope.run(() => useSidebarOverlay({
    api: options.api === false ? undefined : api,
    overlaid,
    model: () => (tooLarge.value ? null : { width: width.value } as unknown as SidebarOverlayModel),
    ...callbacks
  }))!
  const emit = (event: SidebarOverlayEvent) => listener?.(event)
  return { show, hide, overlaid, width, tooLarge, session, emit, ...callbacks, dispose: () => scope.stop() }
}

describe('the shell side of the rail over the page', () => {
  it('asks main to show each opening once, with plain data, and updates it while it shows', async () => {
    const h = harness()
    try {
      h.overlaid.value = true
      expect(h.show).toHaveBeenCalledWith({ id: 1, model: { width: 280 } })
      expect(h.delegate).toHaveBeenCalledWith(true)
      h.emit({ id: 1, kind: 'shown' })
      expect(h.session.shownId).toBe(1)
      h.width.value = 300
      await nextTick()
      expect(h.show).toHaveBeenLastCalledWith({ id: 1, model: { width: 300 } })
      // The same rail again is not sent again.
      h.width.value = 300
      await nextTick()
      expect(h.show).toHaveBeenCalledTimes(2)
      h.emit({ id: 1, kind: 'pointer', hovered: true, held: false })
      expect(h.pointer).toHaveBeenCalledWith({ hovered: true, held: false })
      h.emit({ id: 1, kind: 'intent', intent: { kind: 'select-tab', tabId: 'alpha' } })
      expect(h.intent).toHaveBeenCalledWith({ kind: 'select-tab', tabId: 'alpha' })
      h.overlaid.value = false
      expect(h.hide).toHaveBeenCalledWith(1)
      expect(h.delegate).toHaveBeenLastCalledWith(false)
      h.overlaid.value = true
      expect(h.show).toHaveBeenLastCalledWith({ id: 2, model: { width: 300 } })
    } finally { h.dispose() }
  })

  it('opens the shell\'s own rail when main cannot show an opening, or has no view for it', async () => {
    const h = harness()
    try {
      h.overlaid.value = true
      h.emit({ id: 1, kind: 'unavailable' })
      expect(h.delegate).toHaveBeenLastCalledWith(false)
      expect(h.refused).toHaveBeenCalledOnce()
      // A rail grown past what main draws.
      h.overlaid.value = false
      h.overlaid.value = true
      h.tooLarge.value = true
      await nextTick()
      expect(h.hide).toHaveBeenLastCalledWith(2)
      expect(h.refused).toHaveBeenCalledTimes(2)
    } finally { h.dispose() }
    const without = harness({ api: false })
    try {
      without.overlaid.value = true
      expect(without.refused).toHaveBeenCalledOnce()
      expect(without.delegate).not.toHaveBeenCalled()
    } finally { without.dispose() }
  })

  it('closes the rail when main takes it down, ignores another opening\'s events, and closes it on Escape', () => {
    const h = harness()
    try {
      h.overlaid.value = true
      h.emit({ id: 9, kind: 'hidden', reason: 'blur' })
      expect(h.hidden).not.toHaveBeenCalled()
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(h.intent).not.toHaveBeenCalled()
      h.emit({ id: 1, kind: 'shown' })
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      expect(h.intent).toHaveBeenCalledWith({ kind: 'dismiss' })
      h.emit({ id: 1, kind: 'hidden', reason: 'occluded' })
      expect(h.hidden).toHaveBeenCalledOnce()
      expect(h.session.shownId).toBeUndefined()
    } finally { h.dispose() }
  })
})

describe('viewport rules in the rail over the page', () => {
  it('follows the shell\'s viewport for rules that test only its width or height', () => {
    expect(viewportQuery('(max-height: 600px)')).toEqual([[{ bound: 'max', axis: 'height', value: 600 }]])
    const query = viewportQuery('(min-width: 900px) and (max-width: 1200px), (max-height: 500px)')!
    expect(viewportQueryMatches(query, { width: 1000, height: 800 })).toBe(true)
    expect(viewportQueryMatches(query, { width: 1300, height: 800 })).toBe(false)
    expect(viewportQueryMatches(query, { width: 1300, height: 400 })).toBe(true)
    for (const media of ['(prefers-reduced-motion: reduce)', 'print', '(max-width: 40em)', '(max-width: 600px) and (hover: none)', '']) {
      expect(viewportQuery(media)).toBeNull()
    }
  })
})
