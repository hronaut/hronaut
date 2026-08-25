import { computed, watch, type Ref } from 'vue'
import type { AppUpdateState } from '../../../shared/types.js'
import {
  shouldAutoDismissUpdateStatus,
  shouldShowUpdateStatusPill,
  UPDATE_STATUS_DISMISS_MS
} from '../../../shared/update-presentation.js'

export interface UpdateNoticePresentationControllerOptions {
  open: Ref<boolean>
  settingsOpen: Readonly<Ref<boolean>>
  state: Readonly<Ref<AppUpdateState>>
  dismissAfterMs?: number
}

export function useUpdateNoticePresentationController(
  options: UpdateNoticePresentationControllerOptions
) {
  let dismissTimer: number | undefined
  let disposed = false

  const showStatusPill = computed(() => (
    options.open.value
    && !options.settingsOpen.value
    && shouldShowUpdateStatusPill(options.state.value.status)
  ))

  function clearDismissTimer(): void {
    if (dismissTimer === undefined) return
    window.clearTimeout(dismissTimer)
    dismissTimer = undefined
  }

  const stopDismissWatch = watch(
    [options.open, () => options.state.value.status],
    ([open, status]) => {
      clearDismissTimer()
      if (!open || !shouldAutoDismissUpdateStatus(status)) return
      dismissTimer = window.setTimeout(() => {
        dismissTimer = undefined
        if (!disposed) options.open.value = false
      }, options.dismissAfterMs ?? UPDATE_STATUS_DISMISS_MS)
    },
    { flush: 'sync' }
  )

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopDismissWatch()
    clearDismissTimer()
  }

  return { showStatusPill, dispose }
}

export type UpdateNoticePresentationController = ReturnType<typeof useUpdateNoticePresentationController>
