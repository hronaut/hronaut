import { nextTick, onBeforeUnmount, watch, type Ref } from 'vue'

export interface ModalDialogFocusOptions {
  open: Readonly<Ref<boolean>>
  panel: Readonly<Ref<HTMLElement | null>>
  focusKey?: Readonly<Ref<unknown>>
  afterLayout?: () => void
  focusOnOpen?: boolean
}

interface ActiveDialog {
  panel: Readonly<Ref<HTMLElement | null>>
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

const activeDialogs: ActiveDialog[] = []
let listeningDocument: Document | null = null
let listeningWindow: Window | null = null
let returnFocus: HTMLElement | null = null
let restoreGeneration = 0
let reactivationGeneration = 0

function topDialogPanel(): HTMLElement | null {
  return activeDialogs.at(-1)?.panel.value ?? null
}

function isFocusable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let candidate: HTMLElement | null = element; candidate; candidate = candidate.parentElement) {
    const style = getComputedStyle(candidate)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function focusableElements(panel: HTMLElement): HTMLElement[] {
  return Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(isFocusable)
}

function focusInside(panel: HTMLElement, backwards = false): void {
  const focusable = focusableElements(panel)
  const target = backwards ? focusable.at(-1) : focusable[0]
  ;(target ?? panel).focus({ preventScroll: true })
}

function handleModalKeydown(event: KeyboardEvent): void {
  if (
    event.defaultPrevented
    || event.key !== 'Tab'
    || event.altKey
    || event.ctrlKey
    || event.metaKey
  ) return
  const panel = topDialogPanel()
  if (!panel) return
  const focusable = focusableElements(panel)
  const activeElement = panel.ownerDocument.activeElement
  const first = focusable[0]
  const last = focusable.at(-1)
  const escaped = !(activeElement instanceof Node) || !panel.contains(activeElement)
  const wrapsBackwards = event.shiftKey && (activeElement === panel || activeElement === first)
  const wrapsForwards = !event.shiftKey && (activeElement === panel || activeElement === last)
  if (!escaped && !wrapsBackwards && !wrapsForwards && focusable.length > 0) return
  event.preventDefault()
  focusInside(panel, event.shiftKey)
}

function handleModalFocusIn(event: FocusEvent): void {
  const panel = topDialogPanel()
  if (!panel || (event.target instanceof Node && panel.contains(event.target))) return
  focusInside(panel)
}

async function focusTopDialogAfterWindowActivation(operationGeneration: number): Promise<void> {
  await nextTick()
  if (operationGeneration !== reactivationGeneration) return
  const applicationFocused = await applicationHasFocus()
  if (operationGeneration !== reactivationGeneration || !applicationFocused) return
  const panel = topDialogPanel()
  if (!panel || panel.contains(panel.ownerDocument.activeElement)) return
  panel.focus({ preventScroll: true })
}

function handleModalWindowFocus(): void {
  void focusTopDialogAfterWindowActivation(++reactivationGeneration)
}

function syncDocumentListeners(): void {
  if (activeDialogs.length > 0) {
    if (listeningDocument) return
    listeningDocument = document
    listeningWindow = listeningDocument.defaultView
    listeningDocument.addEventListener('keydown', handleModalKeydown, true)
    listeningDocument.addEventListener('focusin', handleModalFocusIn, true)
    listeningWindow?.addEventListener('focus', handleModalWindowFocus)
    return
  }
  reactivationGeneration += 1
  listeningDocument?.removeEventListener('keydown', handleModalKeydown, true)
  listeningDocument?.removeEventListener('focusin', handleModalFocusIn, true)
  listeningWindow?.removeEventListener('focus', handleModalWindowFocus)
  listeningDocument = null
  listeningWindow = null
}

function removeActiveDialog(dialog: ActiveDialog): void {
  const index = activeDialogs.lastIndexOf(dialog)
  if (index >= 0) activeDialogs.splice(index, 1)
  syncDocumentListeners()
}

async function applicationHasFocus(): Promise<boolean> {
  const shell = window.hronautShell
  if (!shell?.isWindowFocused) return document.hasFocus()
  try {
    return await shell.isWindowFocused()
  } catch {
    return false
  }
}

export function useModalDialogFocus(options: ModalDialogFocusOptions): void {
  let registered = false
  let focusGeneration = 0
  const activeDialog: ActiveDialog = { panel: options.panel }

  const stop = watch(
    () => [options.open.value, options.focusKey?.value] as const,
    async ([open]) => {
      if (open) {
        if (!registered) {
          if (activeDialogs.length === 0 && returnFocus === null) {
            const activeElement = document.activeElement
            returnFocus = activeElement instanceof HTMLElement && activeElement !== document.body
              ? activeElement
              : null
          }
          activeDialogs.push(activeDialog)
          syncDocumentListeners()
          registered = true
        }
        const operationGeneration = ++focusGeneration
        const focusState = applicationHasFocus()
        await nextTick()
        if (operationGeneration !== focusGeneration || !options.open.value) return
        const applicationWasFocused = await focusState
        if (operationGeneration !== focusGeneration || !options.open.value) return
        // Request-driven chrome may appear while the human is typing in another
        // application. Focusing it in that state can activate Hronaut on some
        // desktop environments; the trap still takes over when the user returns.
        if (options.focusOnOpen !== false && applicationWasFocused) {
          const applicationIsFocused = await applicationHasFocus()
          if (operationGeneration !== focusGeneration || !options.open.value) return
          if (applicationIsFocused) options.panel.value?.focus({ preventScroll: true })
        }
        options.afterLayout?.()
        return
      }

      if (!registered) return
      registered = false
      removeActiveDialog(activeDialog)
      focusGeneration += 1
      const operationGeneration = ++restoreGeneration
      await nextTick()
      if (operationGeneration !== restoreGeneration) return
      const applicationFocused = await applicationHasFocus()
      if (operationGeneration !== restoreGeneration) return
      const remainingPanel = topDialogPanel()
      if (remainingPanel) {
        if (applicationFocused && !remainingPanel.contains(document.activeElement)) focusInside(remainingPanel)
        return
      }
      options.afterLayout?.()
      const target = returnFocus
      returnFocus = null
      if (!applicationFocused || !target?.isConnected) return
      target.focus({ preventScroll: true })
    },
    { immediate: true }
  )

  onBeforeUnmount(() => {
    focusGeneration += 1
    restoreGeneration += 1
    if (registered) {
      registered = false
      removeActiveDialog(activeDialog)
    }
    if (activeDialogs.length === 0) returnFocus = null
    stop()
  })
}
