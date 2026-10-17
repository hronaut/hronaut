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
  browser: Pick<HronautApi, 'onUndoOffered' | 'undo' | 'holdUndo' | 'finishUndo'>
  toasts: Pick<AppToastController, 'show'>
  translate: (key: string, values?: Record<string, unknown>, plural?: number) => string
}

function validOffer(offer: unknown): offer is UndoOffer {
  if (!offer || typeof offer !== 'object') return false
  const candidate = offer as Partial<UndoOffer>
  return isUndoToken(candidate.token) && typeof candidate.kind === 'string' && Object.hasOwn(UNDO_TITLE_KEYS, candidate.kind)
    && typeof candidate.name === 'string' && Number.isSafeInteger(candidate.count) && candidate.count! >= 1
}

/**
 * Shows main's offers to undo the person's latest reversible action as a toast with an Undo button. The toast drives
 * the offer: being on it holds the offer, and closing it any other way ends the offer.
 */
export function useUndoToasts(options: UndoToastsOptions) {
  const { translate: t } = options
  let disposed = false

  async function undo(offer: UndoOffer): Promise<void> {
    try {
      const undone = await options.browser.undo(offer.token)
      if (!disposed && !undone) options.toasts.show('info', t('undo.expiredTitle'), t('undo.expired'))
    } catch (error) {
      if (!disposed) options.toasts.show('error', t('undo.failed'), friendlyUiError(error, t('undo.failedDescription')))
    }
  }

  function show(offer: unknown): void {
    if (disposed || !validOffer(offer)) return
    const title = t(UNDO_TITLE_KEYS[offer.kind], { count: offer.count }, offer.count)
    options.toasts.show('success', title, offer.name, {
      duration: UNDO_OFFER_MS,
      action: { label: t('undo.action'), ariaLabel: t('undo.actionAria', { title }), run: () => undo(offer) },
      onRetain: () => { void options.browser.holdUndo(offer.token).catch(() => undefined) },
      onClose: () => { void options.browser.finishUndo(offer.token).catch(() => undefined) }
    })
  }

  const stop = options.browser.onUndoOffered(show)

  function dispose(): void {
    if (disposed) return
    disposed = true
    stop()
  }

  return { dispose }
}
