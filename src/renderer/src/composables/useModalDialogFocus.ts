import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

export interface ModalDialogFocusOptions {
  open: Readonly<Ref<boolean>>
  panel: Readonly<Ref<HTMLElement | null>>
  afterLayout?: () => void
  focusOnOpen?: boolean
}

let activeDialogCount = 0
let returnFocus: HTMLElement | null = null
let restoreGeneration = 0

export function useModalDialogFocus(options: ModalDialogFocusOptions): void {
  let registered = false
  let focusGeneration = 0

  const stop = watch(options.open, async (open) => {
    if (open) {
      if (!registered) {
        if (activeDialogCount === 0 && returnFocus === null) {
          const activeElement = document.activeElement
          returnFocus = activeElement instanceof HTMLElement && activeElement !== document.body
            ? activeElement
            : null
        }
        activeDialogCount += 1
        registered = true
      }
      const operationGeneration = ++focusGeneration
      await nextTick()
      if (operationGeneration !== focusGeneration || !options.open.value) return
      if (options.focusOnOpen !== false) options.panel.value?.focus({ preventScroll: true })
      options.afterLayout?.()
      return
    }

    if (!registered) return
    registered = false
    activeDialogCount = Math.max(0, activeDialogCount - 1)
    focusGeneration += 1
    const operationGeneration = ++restoreGeneration
    await nextTick()
    if (operationGeneration !== restoreGeneration || activeDialogCount > 0) return
    options.afterLayout?.()
    const target = returnFocus
    returnFocus = null
    if (!target?.isConnected) return
    target.focus({ preventScroll: true })
  }, { immediate: true })

  onBeforeUnmount(() => {
    focusGeneration += 1
    restoreGeneration += 1
    if (registered) {
      registered = false
      activeDialogCount = Math.max(0, activeDialogCount - 1)
    }
    if (activeDialogCount === 0) returnFocus = null
    stop()
  })
}
