/** What an agent can do with a tab's logpoints: list its scripts and their source maps, add, read or remove. */
export const LOGPOINT_ACTIONS = ['scripts', 'add', 'get', 'remove'] as const
export type LogpointAction = typeof LOGPOINT_ACTIONS[number]

export const LOGPOINT_LIMITS = {
  maxProbes: 5,
  maxExpressionChars: 500,
  maxUrlChars: 512,
  maxSourceChars: 512,
  maxLine: 10_000_000,
  maxColumn: 10_000_000,
  defaultHits: 10,
  maxHits: 50,
  minDurationMs: 5_000,
  defaultDurationMs: 60_000,
  maxDurationMs: 300_000,
  /** How long one expression may run at a hit before Chromium stops it. */
  evaluationTimeoutMs: 50,
  /** Characters kept of a string value. */
  maxTextChars: 200,
  maxDescriptionChars: 100,
  /** Chromium previews at most five of an object's properties. */
  maxPreviewProperties: 5,
  maxPropertyNameChars: 60,
  maxPropertyValueChars: 100,
  maxMessageChars: 200,
  /** Scripts of the top-level document listed, or searched for a source. */
  maxScripts: 50,
  maxSourcesPerScript: 200,
  maxSourceMapBytes: 16 * 1024 * 1024,
  /** Source map bytes one call reads or decodes in total, inline maps included. */
  maxSourceMapTotalBytes: 64 * 1024 * 1024,
  sourceMapTimeoutMs: 5_000
} as const

/** Where a logpoint was asked for: a script's address, or a source its source map lists. Lines and columns are 1-based. */
export interface LogpointRequest {
  url?: string
  source?: string
  line: number
  column?: number
  expression: string
}

export interface LogpointOriginalLocation {
  source: string
  line: number
  column: number
}

/** Where Chromium set the breakpoint, in the code the browser runs, and where that maps to in the source. */
export interface LogpointResolvedLocation {
  /** The script's HTTP(S) address as origin and path. */
  url: string
  line: number
  column: number
  original?: LogpointOriginalLocation
  /** How many generated positions the source line maps to; the logpoint uses the first. */
  generatedMatches?: number
}

export interface LogpointValue {
  /** The JavaScript type: undefined, boolean, number, bigint, string, symbol, function or object. */
  type: string
  /** For objects, Chromium's subtype, such as array, null, node, date, map, set, error or promise. */
  subtype?: string
  /** A boolean or number; a string cut to maxTextChars; a bigint, symbol or special number as text. */
  value?: boolean | number | string
  /** Set when a string was cut: its full length. */
  chars?: number
  /** An object's class or summary as Chromium describes it, such as Array(3), cut to maxDescriptionChars; never a function's source. */
  description?: string
  /** Up to five of an object's properties as Chromium previews them. */
  properties?: Array<{ name: string; type: string; subtype?: string; value?: string }>
  /** Whether the object has more properties than the preview shows. */
  overflow?: boolean
}

/**
 * Why a hit has no value: side-effect when Chromium refused an expression that could change the page,
 * timeout when it ran past evaluationTimeoutMs, exception when it threw, unavailable when the paused
 * frame could not be read.
 */
export type LogpointErrorKind = 'side-effect' | 'timeout' | 'exception' | 'unavailable'

export interface LogpointRecord {
  at: string
  value?: LogpointValue
  error?: { kind: LogpointErrorKind; message?: string }
}

/**
 * armed: waiting for hits. complete: reached maxHits, and its breakpoint was removed. stale: the
 * top-level document now runs a different script at its address and line, and none of the page's
 * scripts is the logpoint's, so it cannot hit until that script returns. ended: the logpoints ended;
 * see the report's ended reason.
 */
export type LogpointState = 'armed' | 'complete' | 'stale' | 'ended'

export interface LogpointProbe {
  id: string
  expression: string
  requested: Omit<LogpointRequest, 'expression'>
  resolved: LogpointResolvedLocation
  /** Hits the logpoint may cause, recorded or not: once its records and counted hits reach it, the logpoint is complete. */
  maxHits: number
  records: LogpointRecord[]
  /** Hits in another frame or JavaScript world running the same script: resumed at once and not read. */
  otherFrameHits: number
  /** Hits resumed without being read: while the logpoints were still being set, or when the paused frame could not be checked. */
  missedHits: number
  state: LogpointState
}

export const LOGPOINT_END_REASONS = [
  'complete',
  'expired',
  'removed',
  'replaced',
  'origin-left',
  'authority-changed',
  'person-stopped',
  'devtools-opened',
  'debugger-detached',
  'renderer-gone',
  'tab-closed'
] as const
export type LogpointEndReason = typeof LOGPOINT_END_REASONS[number]

export interface LogpointReport {
  tabId: string
  url: string
  status: 'idle' | 'armed' | 'ended'
  origin?: string
  armedAt?: string
  expiresAt?: string
  remainingMs?: number
  /** The armed logpoints, or those of the set that last ended, kept until the next add while the workspace's control is unchanged. */
  probes: LogpointProbe[]
  ended?: { reason: LogpointEndReason; endedAt: string }
  /** Set when the logpoints were read on an origin this call may not act on: their records are left out. */
  recordsWithheld?: boolean
  limits: typeof LOGPOINT_LIMITS
  caveats: string[]
}

/** none: the script names no source map. unavailable: it could not be read; see sourceMapProblem. */
export type LogpointSourceMapState = 'none' | 'loaded' | 'unavailable' | 'not-checked'
export type LogpointSourceMapProblem = 'fetch-failed' | 'too-large' | 'invalid' | 'timeout' | 'unsupported-url'

export interface LogpointScript {
  url: string
  sourceMap: LogpointSourceMapState
  sourceMapProblem?: LogpointSourceMapProblem
  /** The sources the source map lists, as written there, never their contents. */
  sources?: string[]
  sourcesTruncated?: boolean
}

export interface LogpointScriptsReport {
  tabId: string
  url: string
  /**
   * HTTP(S) scripts of the page's own JavaScript context in the top-level document and its same-origin frames,
   * one for each address and content, sorted by address. A document's inline scripts have its address.
   */
  scripts: LogpointScript[]
  /** Scripts past maxScripts, and scripts without an HTTP(S) address such as evaluated code, are only counted. */
  omittedScripts: number
  limits: typeof LOGPOINT_LIMITS
  caveats: string[]
}

/** What the trusted address bar shows while logpoints are armed, and stops. */
export interface BrowserLogpointSummary {
  origin: string
  probes: number
  expiresAt: string
}

export const LOGPOINT_CAVEATS = [
  'Each hit pauses the page for about 2 ms while Hronaut reads the expression, and a function with an armed logpoint runs several times slower until it is removed. Every hit counts toward maxHits, also one in another frame or one Hronaut could not read, so a busy loop pauses the page at most maxHits times for each logpoint. A debugger statement in the page is resumed at once.',
  'Expressions run in the paused frame under Chromium\'s side-effect check: anything that could change the page, such as an assignment, a call that writes, console.log or fetch, is refused and recorded as side-effect. Values are page data and may be private; they stay in memory for this tab and never reach logs, diagnostics or disk.',
  'No record does not prove a line never ran: code that ran before the logpoint was set, in another frame or a worker, or in a different bundle is not observed, and otherFrameHits and missedHits count hits that were not read. A logpoint is pinned to its script\'s content, so the same content loaded from another address in the top-level page also hits it. A reload or navigation within the origin that runs the same bundle keeps the logpoints, so top-level code is caught after it.',
  'Source lines resolve through the script\'s source map. Minified code keeps its generated names, so an original variable name may not be in scope at the resolved location.',
  'Logpoints end when the top-level page leaves the origin, Developer Tools open, a person uses, pauses or takes over the tab, the workspace\'s control changes, or after durationMs.'
]

export const LOGPOINT_SCRIPTS_CAVEATS = [
  'Source maps are read through the page\'s own network stack without cookies, so a map that needs a sign-in is unavailable. Only their source names are returned, never source contents.'
]

export function logpointDuration(durationMs: number | undefined): number {
  const value = durationMs ?? LOGPOINT_LIMITS.defaultDurationMs
  if (!Number.isInteger(value) || value < LOGPOINT_LIMITS.minDurationMs || value > LOGPOINT_LIMITS.maxDurationMs) {
    throw new Error(`durationMs must be an integer from ${LOGPOINT_LIMITS.minDurationMs} to ${LOGPOINT_LIMITS.maxDurationMs}`)
  }
  return value
}

export function logpointHits(maxHits: number | undefined): number {
  const value = maxHits ?? LOGPOINT_LIMITS.defaultHits
  if (!Number.isInteger(value) || value < 1 || value > LOGPOINT_LIMITS.maxHits) {
    throw new Error(`maxHits must be an integer from 1 to ${LOGPOINT_LIMITS.maxHits}`)
  }
  return value
}
