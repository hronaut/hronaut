/** Actions of the virtual passkey authenticator an agent can attach to one tab for a localhost origin. */
export const VIRTUAL_PASSKEY_ACTIONS = ['start', 'status', 'configure', 'stop'] as const
export type VirtualPasskeyAction = typeof VIRTUAL_PASSKEY_ACTIONS[number]

export const VIRTUAL_PASSKEY_LIMITS = {
  minDurationMs: 60_000,
  defaultDurationMs: 600_000,
  maxDurationMs: 1_800_000,
  maxOriginChars: 300
} as const

/**
 * Why a virtual passkey ended: the agent stopped it, it expired, a frame of
 * the page (the top-level page included) started loading another origin, the
 * starting call's authority changed (agent control, pause, write ownership,
 * capability, workspace or human input on the page), the person stopped it
 * from the address bar, Developer Tools opened, Hronaut's debugger session
 * ended, the page's renderer exited or the tab closed.
 */
export type VirtualPasskeyEndReason =
  | 'stopped'
  | 'expired'
  | 'origin-left'
  | 'authority-changed'
  | 'person-stopped'
  | 'devtools-opened'
  | 'debugger-detached'
  | 'renderer-exited'
  | 'tab-closed'

export interface VirtualPasskeySession {
  /** Whether the authenticator reports user verification (biometrics or PIN) as passed. */
  userVerified: boolean
  startedAt: string
  expiresAt: string
  remainingMs: number
  /** Credentials the authenticator holds: created minus deleted by the page. */
  credentials: number
  /** Credentials the authenticator created, whether or not the page then accepted them. */
  registrations: number
  /** Signatures the authenticator made for a sign-in, whether or not the page then accepted them. */
  signIns: number
}

export interface VirtualPasskeyReport {
  tabId: string
  /** The origin the call named. A session for another origin is never described. */
  origin: string
  status: 'active' | 'inactive'
  passkey?: VirtualPasskeySession
  lastEnded?: {
    reason: VirtualPasskeyEndReason
    endedAt: string
    /** False only when Hronaut could not confirm that the browser removed the authenticator; close the tab to be sure. */
    removalConfirmed: boolean
  }
  caveats: string[]
}

/** What the trusted address bar shows while a virtual passkey is active, and stops. */
export interface BrowserVirtualPasskeySummary {
  origin: string
  expiresAt: string
}

export const VIRTUAL_PASSKEY_CAVEATS = [
  'The authenticator is software held in memory for this tab only. Its credentials are lost when it ends and never persist, export or reach the computer\'s own authenticators; accounts the page registered on its server stay there.',
  'Sign-in works when the page names the credential (allowCredentials), as after a username step. In Hronaut\'s browser, a username-less sign-in that lists no credentials fails with NotAllowedError even though the authenticator signed.',
  'registrations and signIns count what the authenticator did, not what the page accepted; check the page or its server for the outcome.',
  'Other tabs, popups and workspaces keep the computer\'s own authenticators, and the session ends as soon as any frame of the page starts loading another origin.'
]

/**
 * The exact localhost origin a virtual passkey may serve, in the browser's
 * own serialization: http or https, the host localhost or a subdomain of it,
 * an optional port, and nothing else. Anything else throws.
 */
export function virtualPasskeyOrigin(value: string): string {
  const invalid = new Error('origin must be an exact localhost origin such as http://localhost:3000 or https://app.localhost:8443, with no path, query or trailing slash')
  if (value.length > VIRTUAL_PASSKEY_LIMITS.maxOriginChars) throw invalid
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw invalid
  }
  const localhost = parsed.hostname === 'localhost' || parsed.hostname.endsWith('.localhost')
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || !localhost || parsed.origin !== value) throw invalid
  return parsed.origin
}

/** The session length a start asks for, defaulting and bounded. */
export function virtualPasskeyDuration(durationMs: number | undefined): number {
  const duration = durationMs ?? VIRTUAL_PASSKEY_LIMITS.defaultDurationMs
  if (!Number.isInteger(duration) || duration < VIRTUAL_PASSKEY_LIMITS.minDurationMs || duration > VIRTUAL_PASSKEY_LIMITS.maxDurationMs) {
    throw new Error(`durationMs must be a whole number from ${VIRTUAL_PASSKEY_LIMITS.minDurationMs} to ${VIRTUAL_PASSKEY_LIMITS.maxDurationMs}`)
  }
  return duration
}
