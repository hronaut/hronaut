import type { HronautApi } from '../../../shared/types.js'
import { isUndoToken, UNDO_OFFER_MS, type UndoKind, type UndoOffer } from '../../../shared/undo.js'
import { friendlyUiError, type AppToastController } from './useAppToastController'

const UNDO_TITLE_KEYS: Record<UndoKind, string> = {
  'tabs-closed': 'undo.tabsClosed',
  'workspace-archived': 'undo.workspaceArchived',
  'workspace-closed': 'undo.workspaceClosed',
  'bookmark-removed': 'undo.bookmarkRemoved'
}

export interface UndoToastsOptions {
  browser: Pick<HronautApi, 'onUndoOffered' | 'onUndoEnded' | 'undo' | 'holdUndo' | 'finishUndo'>
  toasts: Pick<AppToastController, 'show' | 'dismiss' | 'act'>
  translate: (key: string, values?: Record<string, unknown>, plural?: number) => string
  /** Where Ctrl/Cmd+Z undoes the latest action; the shell window by default. */
  keyTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  mac?: boolean
}

/** How long a toast whose offer ended waits for a newer offer to take its place. */
const ENDED_TOAST_GRACE_MS = 80

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit'])

/** A field that keeps Ctrl/Cmd+Z for undoing its own text. */
function editsText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(target.type)
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable
}

function validOffer(offer: unknown): offer is UndoOffer {
  if (!offer || typeof offer !== 'object') return false
  const candidate = offer as Partial<UndoOffer>
  return isUndoToken(candidate.token) && typeof candidate.kind === 'string' && Object.hasOwn(UNDO_TITLE_KEYS, candidate.kind)
    && typeof candidate.name === 'string' && Number.isSafeInteger(candidate.count) && candidate.count! >= 1
}

/**
 * Shows main's offers to undo the person's latest reversible action as a toast with an Undo button. The toast drives
 * the offer: being on it holds the offer, and closing it any other way ends the offer. A toast that takes its place
 * leaves the offer to main's own timer. Ctrl/Cmd+Z in the shell, outside text fields, undoes the offer while main
 * still has it, toast shown or not.
 */
export function useUndoToasts(options: UndoToastsOptions) {
  const { translate: t } = options
  const mac = options.mac ?? window.hronautShell?.windowChrome.platform === 'darwin'
  let disposed = false
  /** The offer main still has, whose Undo the person can use. */
  let live: UndoOffer | undefined
  /** The toast showing it, until it closes or another toast takes its place. */
  let visible: { token: string; id: number } | undefined

  async function undo(offer: UndoOffer): Promise<void> {
    if (live?.token === offer.token) live = undefined
    try {
      const undone = await options.browser.undo(offer.token)
      // A newer offer keeps its toast: "Nothing to undo" about an older one would replace it.
      if (!disposed && !undone && !live) options.toasts.show('info', t('undo.expiredTitle'), t('undo.expired'))
    } catch (error) {
      // The failure is said unless it would replace a newer offer's Undo toast on screen; this offer's own toast has
      // already gone.
      if (!disposed && !visible) options.toasts.show('error', t('undo.failed'), friendlyUiError(error, t('undo.failedDescription')))
    }
  }

  function show(offer: unknown): void {
    if (disposed || !validOffer(offer)) return
    live = offer
    const title = t(UNDO_TITLE_KEYS[offer.kind], { count: offer.count }, offer.count)
    const forget = (): void => {
      if (visible?.token === offer.token) visible = undefined
    }
    const id = options.toasts.show('success', title, offer.name, {
      duration: UNDO_OFFER_MS,
      action: {
        label: t('undo.action'),
        ariaLabel: t('undo.actionAria', { title }),
        run: () => {
          forget()
          void undo(offer)
        }
      },
      onRetain: () => { void options.browser.holdUndo(offer.token).catch(() => undefined) },
      onClose: () => {
        forget()
        void options.browser.finishUndo(offer.token).catch(() => undefined)
      },
      onReplaced: forget
    })
    if (id !== undefined) visible = { token: offer.token, id }
  }

  function ended(token: unknown): void {
    if (disposed || typeof token !== 'string') return
    if (live?.token === token) live = undefined
    // Main ended it: its toast leaves rather than offer an Undo that would do nothing. A newer offer, which main
    // sends right after ending the old one, takes the toast's place instead, so the toast does not flicker.
    window.setTimeout(() => {
      if (disposed || visible?.token !== token) return
      const { id } = visible
      visible = undefined
      options.toasts.dismiss(id)
    }, ENDED_TOAST_GRACE_MS)
  }

  function handleKeydown(event: KeyboardEvent): void {
    const offer = live
    if (!offer || event.defaultPrevented || event.isComposing || event.repeat) return
    if (event.key.toLowerCase() !== 'z' || event.shiftKey || event.altKey || (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)) return
    if (editsText(event.target)) return
    event.preventDefault()
    // Through the toast's own action, so closing the toast does not end the offer first.
    if (visible?.token === offer.token) options.toasts.act(visible.id)
    else void undo(offer)
  }

  const keyTarget = options.keyTarget ?? window
  const stopOffered = options.browser.onUndoOffered(show)
  const stopEnded = options.browser.onUndoEnded(ended)
  keyTarget.addEventListener('keydown', handleKeydown as EventListener)

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopOffered()
    stopEnded()
    keyTarget.removeEventListener('keydown', handleKeydown as EventListener)
  }

  return { dispose }
}
