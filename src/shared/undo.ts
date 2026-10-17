/** How long the Undo toast stays after a reversible action, unless the person is on it. */
export const UNDO_OFFER_MS = 6_000

/** What the person did that Undo puts back. */
export type UndoKind = 'tabs-closed' | 'workspace-archived' | 'workspace-closed' | 'bookmark-removed'

/** Main offers to undo the person's latest reversible action; the token names that one offer. */
export interface UndoOffer {
  token: string
  kind: UndoKind
  /** The tab, workspace or bookmark name, or the latest one closed. */
  name: string
  count: number
}

const UNDO_TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

export function isUndoToken(value: unknown): value is string {
  return typeof value === 'string' && UNDO_TOKEN.test(value)
}
