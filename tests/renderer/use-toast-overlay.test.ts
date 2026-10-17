import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useAppToastController } from '../../src/renderer/src/composables/useAppToastController.js'
import { useToastOverlay } from '../../src/renderer/src/composables/useToastOverlay.js'
import type { ResolvedThemeName } from '../../src/shared/theme.js'
import type { HronautToastOverlayApi, ToastOverlayEvent, ToastOverlayRequest } from '../../src/shared/toast-overlay.js'

function setup(options: { focusInside?: boolean } = {}) {
  const shown: ToastOverlayRequest[] = []
  let listener: ((event: ToastOverlayEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const api: HronautToastOverlayApi = {
    show: (request) => { shown.push(request) },
    onEvent: (next) => { listener = next; return unsubscribe }
  }
  const theme = ref<ResolvedThemeName>('dark')
  const focusInside = ref(options.focusInside ?? false)
  const scope = effectScope()
  const controller = scope.run(() => useAppToastController())!
  const overlay = scope.run(() => useToastOverlay({
    api,
    toasts: controller.toasts,
    controller,
    theme: () => theme.value,
    focusInside: () => focusInside.value
  }))!
  const lastId = () => shown.at(-1)?.toast?.id ?? 0
  return { shown, emit: (event: ToastOverlayEvent) => listener?.(event), unsubscribe, theme, focusInside, scope, controller, overlay, lastId }
}

describe('useToastOverlay', () => {
  it('asks main to draw each toast with an id of its own, and to hide it when it goes', async () => {
    const { shown, controller, scope } = setup()
    await nextTick()
    // Nothing to hide before the first toast.
    expect(shown).toEqual([])
    controller.show('success', 'Tab closed', 'Example Domain', { action: { label: 'Undo', ariaLabel: 'Undo: Tab closed', run: () => undefined } })
    await nextTick()
    expect(shown).toHaveLength(1)
    const first = shown[0]?.toast?.id ?? 0
    expect(first).toBeGreaterThan(0)
    expect(shown[0]).toEqual({
      toast: { id: first, tone: 'success', title: 'Tab closed', message: 'Example Domain', action: { label: 'Undo' } },
      focus: null,
      theme: 'dark'
    })
    // The controller reuses its slot for the next toast; main still gets a new id for it.
    controller.show('info', 'Bookmark removed', 'Docs')
    await nextTick()
    expect(controller.toasts.value[0]?.id).toBe(1)
    expect(shown[1]?.toast).toEqual({ id: first + 1, tone: 'info', title: 'Bookmark removed', message: 'Docs' })
    controller.dismiss(1)
    await nextTick()
    expect(shown[2]).toEqual({ toast: null, focus: null, theme: 'dark' })
    scope.stop()
    expect(shown).toHaveLength(3)
  })

  it('sends focus and theme changes, sends nothing that did not change, and never focuses a missing action', async () => {
    const { shown, controller, overlay, theme, scope } = setup()
    controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run: () => undefined } })
    await nextTick()
    overlay.focusChanged('action')
    await nextTick()
    expect(shown.at(-1)?.focus).toBe('action')
    theme.value = 'sepia'
    await nextTick()
    expect(shown.at(-1)).toMatchObject({ focus: 'action', theme: 'sepia' })
    overlay.focusChanged('action')
    await nextTick()
    expect(shown).toHaveLength(3)
    controller.show('error', 'Reload failed', 'Renderer unavailable')
    await nextTick()
    expect(shown.at(-1)?.focus).toBeNull()
    scope.stop()
  })

  it('runs what the person does on the drawn toast, and ignores events of a toast already replaced', async () => {
    const { emit, controller, lastId, scope } = setup()
    const run = vi.fn()
    const onRetain = vi.fn()
    controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run }, onRetain })
    await nextTick()
    const first = lastId()
    emit({ id: first, kind: 'retain' })
    expect(onRetain).toHaveBeenCalledTimes(1)
    // Replaced in the same slot: a click meant for the old toast must not run the new one's action.
    const replacement = vi.fn()
    controller.show('success', 'Workspace closed', 'Shop', { action: { label: 'Undo', run: replacement } })
    emit({ id: first, kind: 'act' })
    await nextTick()
    emit({ id: first, kind: 'act' })
    expect(run).not.toHaveBeenCalled()
    expect(replacement).not.toHaveBeenCalled()
    emit({ id: lastId(), kind: 'act' })
    expect(replacement).toHaveBeenCalledTimes(1)
    expect(controller.toasts.value).toEqual([])
    scope.stop()
  })

  it('lets the pointer leaving release the toast only while keyboard focus is not in the shell copy', async () => {
    vi.useFakeTimers()
    try {
      const { emit, controller, focusInside, lastId, scope } = setup({ focusInside: true })
      controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run: () => undefined } })
      await nextTick()
      emit({ id: lastId(), kind: 'retain' })
      emit({ id: lastId(), kind: 'release' })
      vi.advanceTimersByTime(10_000)
      expect(controller.toasts.value).toHaveLength(1)
      focusInside.value = false
      emit({ id: lastId(), kind: 'release' })
      vi.advanceTimersByTime(3_600)
      expect(controller.toasts.value).toEqual([])
      scope.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the shell copy where main cannot draw the toast, until main draws it', async () => {
    const { emit, controller, overlay, lastId, scope } = setup()
    expect(overlay.mirrored.value).toBe(true)
    controller.show('success', 'Tab closed', 'Example')
    await nextTick()
    emit({ id: lastId() + 1, kind: 'unavailable' })
    expect(overlay.mirrored.value).toBe(true)
    emit({ id: lastId(), kind: 'unavailable' })
    expect(overlay.mirrored.value).toBe(false)
    emit({ id: lastId(), kind: 'shown' })
    expect(overlay.mirrored.value).toBe(true)
    emit({ id: lastId(), kind: 'unavailable' })
    // The next toast tries main again.
    controller.show('info', 'Bookmark removed', 'Docs')
    await nextTick()
    expect(overlay.mirrored.value).toBe(true)
    scope.stop()
  })

  it('hides the drawn toast and stops listening when the shell goes', async () => {
    const { shown, controller, unsubscribe, scope } = setup()
    controller.show('success', 'Tab closed', 'Example')
    await nextTick()
    scope.stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(shown.at(-1)).toEqual({ toast: null, focus: null, theme: 'dark' })
  })

  it('keeps toasts in the shell where there is no overlay, as in the detached panel window', () => {
    const scope = effectScope()
    const controller = scope.run(() => useAppToastController())!
    const overlay = scope.run(() => useToastOverlay({ api: undefined, toasts: controller.toasts, controller, theme: () => 'dark', focusInside: () => false }))!
    expect(overlay.mirrored.value).toBe(false)
    expect(() => overlay.focusChanged('dismiss')).not.toThrow()
    scope.stop()
  })
})
