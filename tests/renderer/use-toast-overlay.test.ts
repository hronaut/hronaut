import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useAppToastController } from '../../src/renderer/src/composables/useAppToastController.js'
import { shellToastFocusedPart, useToastOverlay } from '../../src/renderer/src/composables/useToastOverlay.js'
import type { ResolvedThemeName } from '../../src/shared/theme.js'
import type { HronautToastOverlayApi, ToastOverlayEvent, ToastOverlayFocus, ToastOverlayRequest } from '../../src/shared/toast-overlay.js'

function setup(options: { focusedPart?: ToastOverlayFocus | null } = {}) {
  const shown: ToastOverlayRequest[] = []
  let listener: ((event: ToastOverlayEvent) => void) | undefined
  const unsubscribe = vi.fn()
  const api: HronautToastOverlayApi = {
    show: (request) => { shown.push(request) },
    onEvent: (next) => { listener = next; return unsubscribe }
  }
  const theme = ref<ResolvedThemeName>('dark')
  const focusedPart = ref<ToastOverlayFocus | null>(options.focusedPart ?? null)
  const scope = effectScope()
  const controller = scope.run(() => useAppToastController())!
  const overlay = scope.run(() => useToastOverlay({
    api,
    toasts: controller.toasts,
    controller,
    theme: () => theme.value,
    focusedPart: () => focusedPart.value
  }))!
  const lastId = () => shown.at(-1)?.toast?.id ?? 0
  return { shown, emit: (event: ToastOverlayEvent) => listener?.(event), unsubscribe, theme, focusedPart, scope, controller, overlay, lastId }
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

  it('takes the focus of a new toast from the document, so a button removed with focus in it leaves no ring', async () => {
    const { shown, controller, overlay, focusedPart, scope } = setup()
    controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run: () => undefined } })
    await nextTick()
    overlay.focusChanged('action')
    await nextTick()
    expect(shown.at(-1)?.focus).toBe('action')
    // Enter on Undo: the toast and its focused button go without a focusout.
    controller.act(controller.toasts.value[0].id)
    controller.show('success', 'Tab closed', 'Docs', { action: { label: 'Undo', run: () => undefined } })
    await nextTick()
    expect(shown.at(-1)).toMatchObject({ toast: { message: 'Docs' }, focus: null })
    // Focus that stays in the shell copy as it shows the next toast stays drawn.
    focusedPart.value = 'dismiss'
    controller.show('info', 'Bookmark removed', 'Docs')
    await nextTick()
    expect(shown.at(-1)).toMatchObject({ toast: { title: 'Bookmark removed' }, focus: 'dismiss' })
    scope.stop()
  })

  it('reads which shell toast button has keyboard focus', () => {
    document.body.innerHTML = `<div class="app-toast-region">
      <article class="app-toast app-toast-leave-active"><button data-toast-part="action" id="leaving"></button></article>
      <article class="app-toast"><button data-toast-part="action"><span></span></button><button data-toast-part="dismiss"></button></article>
    </div><button data-toast-part="action" id="elsewhere"></button>`
    expect(shellToastFocusedPart(document.querySelector('.app-toast:not(.app-toast-leave-active) [data-toast-part="action"] span'))).toBe('action')
    expect(shellToastFocusedPart(document.querySelector('[data-toast-part="dismiss"]'))).toBe('dismiss')
    // Undo pressed with Enter: its toast keeps focus while it fades out, but the next toast's buttons do not have it.
    expect(shellToastFocusedPart(document.querySelector('#leaving'))).toBeNull()
    expect(shellToastFocusedPart(document.querySelector('#elsewhere'))).toBeNull()
    expect(shellToastFocusedPart(null)).toBeNull()
    document.body.innerHTML = ''
  })

  it('lets the pointer leaving release the toast only while keyboard focus is not in the shell copy', async () => {
    vi.useFakeTimers()
    try {
      const { emit, controller, focusedPart, lastId, scope } = setup({ focusedPart: 'action' })
      controller.show('success', 'Tab closed', 'Example', { action: { label: 'Undo', run: () => undefined } })
      await nextTick()
      emit({ id: lastId(), kind: 'retain' })
      emit({ id: lastId(), kind: 'release' })
      vi.advanceTimersByTime(10_000)
      expect(controller.toasts.value).toHaveLength(1)
      focusedPart.value = null
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
    const overlay = scope.run(() => useToastOverlay({ api: undefined, toasts: controller.toasts, controller, theme: () => 'dark', focusedPart: () => null }))!
    expect(overlay.mirrored.value).toBe(false)
    expect(() => overlay.focusChanged('dismiss')).not.toThrow()
    scope.stop()
  })
})
