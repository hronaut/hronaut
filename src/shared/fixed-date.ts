/** Actions of the fixed Date staged for one tab's top-level documents. */
export const FIXED_DATE_ACTIONS = ['stage', 'status', 'reset'] as const
export type FixedDateAction = typeof FIXED_DATE_ACTIONS[number]

/** The earliest and latest instants a JavaScript Date can hold, in UTC epoch milliseconds. */
export const FIXED_DATE_MAX_EPOCH_MS = 8_640_000_000_000_000

/**
 * Why a staged fixed Date stopped applying to future documents: the tab loaded
 * another origin, the staging call's authority changed (agent control, write
 * ownership, capability or human input), or the tab left its workspace.
 */
export type FixedDateDisarmReason = 'origin-changed' | 'authority-changed' | 'workspace-changed'

/**
 * What the tab's current top-level document has: the fixed Date, the native
 * one, or unknown after a navigation that may not have committed, a page
 * restored from the back-forward cache, an error page or a renderer exit.
 */
export type FixedDateDocumentState = 'fixed' | 'native' | 'unknown'

export type FixedDateStatus = 'off' | 'staged' | 'active' | 'reset-reload-required' | 'disarmed'

export interface FixedDateResult {
  status: FixedDateStatus
  /** Whether the next same-origin top-level document of the tab gets the fixed Date. */
  armed: boolean
  /** The staged instant, while one is staged or was disarmed. */
  fixedDate?: string
  epochMs?: number
  /** The top-level origin the staged instant is bound to. */
  origin?: string
  currentDocument: FixedDateDocumentState
  /** The instant the current document's Date is fixed at, when it is. */
  currentDocumentFixedDate?: string
  /** Whether a reload or same-origin navigation is needed for the current document to match the staged setting. */
  reloadRequired: boolean
  disarmedReason?: FixedDateDisarmReason
}

/** The page preload's synchronous answer: install the fixed Date in this document, or not. */
export type FixedDateBootstrap = { enabled: false } | { enabled: true; epochMs: number }
