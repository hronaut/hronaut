/** Actions of the ariaNotify recorder an agent can run in one tab. */
export const ARIA_NOTIFY_ACTIONS = ['start', 'get', 'stop', 'clear'] as const
export type AriaNotifyAction = typeof ARIA_NOTIFY_ACTIONS[number]

export const ARIA_NOTIFY_LIMITS = {
  maxAnnouncements: 100,
  maxAnnouncementChars: 1000,
  maxTotalChars: 50_000,
  minDurationMs: 5_000,
  defaultDurationMs: 60_000,
  maxDurationMs: 300_000,
  maxFunctionNameChars: 120,
  maxScriptUrlChars: 512
} as const

/**
 * Why a recording ended: the agent stopped it, it expired, the top-level page went to another origin, the starting
 * call's authority changed (agent control, pause, write ownership, capability or workspace), Developer Tools opened,
 * Hronaut's debugger session ended, the page's renderer exited or the tab closed.
 */
export type AriaNotifyEndReason =
  | 'stopped'
  | 'expired'
  | 'origin-left'
  | 'authority-changed'
  | 'devtools-opened'
  | 'debugger-detached'
  | 'renderer-exited'
  | 'tab-closed'

/** Where the page called ariaNotify from: the first frame of its own code, as the browser ran it (no source maps). */
export interface AriaNotifyCallSite {
  functionName: string
  /** The script's address as origin and path; absent for inline, evaluated and non-HTTP(S) code. */
  scriptUrl?: string
  /** 1-based. */
  line: number
  column: number
}

export interface AriaNotifyAnnouncement {
  /** Milliseconds since the recording started. */
  atMs: number
  text: string
  truncated: boolean
  /** The priority option the page passed, when it was normal or high. */
  priority?: 'normal' | 'high'
  /** document.ariaNotify, or Element.ariaNotify on an element of this tag with this authored role. */
  target: { kind: 'document' } | { kind: 'element'; localName: string; role?: string }
  callSite?: AriaNotifyCallSite
  /** The page's address, as origin and path, when it announced. */
  pageUrl: string
}

export interface AriaNotifyReport {
  tabId: string
  url: string
  status: 'recording' | 'stopped' | 'idle'
  /** Once a recording started: whether the page has ariaNotify at all; false means nothing can be recorded. */
  supported?: boolean
  recording?: { startedAt: string; expiresAt: string; remainingMs: number; origin: string }
  announcements: AriaNotifyAnnouncement[]
  /** Calls past the limits, counted but not kept. */
  dropped: number
  ended?: { reason: AriaNotifyEndReason; endedAt: string }
  limits: typeof ARIA_NOTIFY_LIMITS
  caveats: string[]
}

export const ARIA_NOTIFY_CAVEATS = [
  'Announcements are what the page asked the browser to announce through document.ariaNotify and Element.ariaNotify; '
    + 'they never appear in the DOM, so DOM snapshots and browser_live_region cannot see them. Whether and how a screen reader speaks them is up to it.',
  'Announcement text is page data and can be private. It stays in memory for this tab only and is never persisted, exported or logged.',
  'Hronaut wraps ariaNotify in the top-level document while recording, so the page can notice the wrapper. '
    + 'Frames are not recorded. Stopping restores the original functions in the current document.',
  'The call site is the first frame of the page\'s own code as the browser ran it, without source maps; a page that limits Error stack traces shows none.'
]

/** The recording length a start asks for, defaulting and bounded. */
export function ariaNotifyDuration(durationMs: number | undefined): number {
  const duration = durationMs ?? ARIA_NOTIFY_LIMITS.defaultDurationMs
  if (!Number.isInteger(duration) || duration < ARIA_NOTIFY_LIMITS.minDurationMs || duration > ARIA_NOTIFY_LIMITS.maxDurationMs) {
    throw new Error(`durationMs must be a whole number from ${ARIA_NOTIFY_LIMITS.minDurationMs} to ${ARIA_NOTIFY_LIMITS.maxDurationMs}`)
  }
  return duration
}
