import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { ResolvedThemeName } from '../../../shared/theme'
import type { HronautToastOverlayApi, ToastOverlayFocus, ToastOverlayRequest } from '../../../shared/toast-overlay'
import type { AppToast, AppToastController } from './useAppToastController'

/**
 * Which button of the shell's copy of a toast `active`, the element with keyboard focus, is; null for any other,
 * including one of a toast still on its way out, which keeps focus while it fades.
 */
export function shellToastFocusedPart(active: Element | null): ToastOverlayFocus | null {
  const part = active?.closest<HTMLElement>('.app-toast-region .app-toast:not(.app-toast-leave-active) [data-toast-part]')?.dataset.toastPart
  return part === 'action' || part === 'dismiss' ? part : null
}

// One counter for every toast shown, so a toast after a remount never reuses the id of one main still shows.
let lastOverlayId = 0

export interface ToastOverlayOptions {
  /** Main's toast overlay; undefined where toasts stay in the shell, as in the detached panel window. */
  api: HronautToastOverlayApi | undefined
  toasts: Readonly<Ref<readonly AppToast[]>>
  controller: Pick<AppToastController, 'act' | 'dismiss' | 'retain' | 'release'>
  theme: () => ResolvedThemeName
  /**
   * Which button of the shell's copy of the toast has keyboard focus now, or null. The toast stays while it has focus,
   * when the pointer leaves the drawn one.
   */
  focusedPart: () => ToastOverlayFocus | null
}

export interface ToastOverlayController {
  /** True while main draws the toast above the page; the shell's copy is then for screen readers and the keyboard. */
  mirrored: Readonly<Ref<boolean>>
  /** Which button of the shell's copy has keyboard focus, for main to draw. */
  focusChanged: (focus: ToastOverlayFocus | null) => void
}

/**
 * Shows the shell's toast at the bottom of the page area, where main draws it in a native view above the page, and
 * runs what the person does there. Each toast gets its own id, so a click on one that has just been replaced, even
 * in the same slot, never runs its replacement's action. When main cannot show a toast, the shell shows its own copy.
 */
export function useToastOverlay(options: ToastOverlayOptions): ToastOverlayController {
  const { api } = options
  if (!api) return { mirrored: computed(() => false), focusChanged: () => undefined }
  const focus = ref<ToastOverlayFocus | null>(null)
  const unavailable = ref(false)
  let current: { overlayId: number; toast: AppToast } | null = null
  // What main was last asked to show; an update that changes nothing is not sent again.
  let sent = ''

  function request(theme: ResolvedThemeName): ToastOverlayRequest {
    if (!current) return { toast: null, focus: null, theme }
    const { overlayId, toast } = current
    return {
      toast: {
        id: overlayId,
        tone: toast.tone,
        title: toast.title,
        message: toast.message,
        ...(toast.action ? { action: { label: toast.action.label } } : {})
      },
      // The shell's copy drops a button that went away without telling us its focus left.
      focus: focus.value === 'action' && !toast.action ? null : focus.value,
      theme
    }
  }

  const stop = watch(
    () => [options.toasts.value[0], focus.value, options.theme()] as const,
    ([toast, , theme]) => {
      if (toast !== current?.toast) {
        current = toast ? { overlayId: ++lastOverlayId, toast } : null
        unavailable.value = false
        // A button removed with focus in it, as after Enter on Undo, reports no focus leaving; ask the document.
        focus.value = options.focusedPart()
      }
      // Nothing to hide before the first toast.
      if (!current && !sent) return
      const next = request(theme)
      const serialized = JSON.stringify(next)
      if (serialized === sent) return
      sent = current ? serialized : ''
      api.show(next)
    },
    // After the shell's copy has rendered, so the focus it reports is the new toast's.
    { immediate: true, flush: 'post' }
  )

  const unsubscribe = api.onEvent((event) => {
    const shown = current
    // Events of a toast that has since gone, or been replaced in its slot, are stale.
    if (!shown || event.id !== shown.overlayId || options.toasts.value[0] !== shown.toast) return
    const id = shown.toast.id
    switch (event.kind) {
      case 'shown':
        unavailable.value = false
        return
      case 'unavailable':
        unavailable.value = true
        return
      case 'act':
        options.controller.act(id)
        return
      case 'dismiss':
        options.controller.dismiss(id)
        return
      case 'retain':
        options.controller.retain(id)
        return
      case 'release':
        if (!options.focusedPart()) options.controller.release(id)
    }
  })

  onScopeDispose(() => {
    stop()
    unsubscribe()
    if (sent) api.show({ toast: null, focus: null, theme: options.theme() })
    sent = ''
    current = null
  })

  return {
    mirrored: computed(() => !unavailable.value),
    focusChanged: (next) => { focus.value = next }
  }
}
