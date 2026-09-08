import type { BrowserWorkspaceNavigationPolicy } from '../../shared/types.js'
import { evaluateWorkspaceNavigation } from '../browser/workspace-navigation-policy.js'

type Status = 'PASS' | 'WARN' | 'BLOCKED'
interface Check {
  check: 'ownership' | 'tab' | 'origin' | 'policy' | 'human' | 'session'
  status: Status
  reason: string
  nextAction: string
}

export interface WorkspacePreflightInput {
  // Only the transport owner can establish authorization. The checker must
  // never become a second, weaker workspace authorization implementation.
  authorized: boolean
  tab: { url: string; loading: boolean; sleeping: boolean } | null
  policy: BrowserWorkspaceNavigationPolicy
  expectedOrigin?: string
  paused: boolean
  attentionRequired: boolean
}

function webOrigin(value: string): string | null {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
      ? url.origin : null
  } catch { return null }
}

/** Read-only projection. No URLs, policy rules, IDs, supplied values or page
 * evidence are echoed. A PASS check is not authorization for a future write.
 */
export function workspacePreflight(input: WorkspacePreflightInput): {
  status: Status
  checks: Check[]
  sessionEvidence: { status: 'UNAVAILABLE'; verifiedAt: null; ageMs: null }
  writeSafety: 'NOT_ESTABLISHED'
} {
  const checks: Check[] = []
  const add = (check: Check['check'], status: Status, reason: string, nextAction: string): void => {
    checks.push({ check, status, reason, nextAction })
  }
  const report = () => ({
    status: (checks.some(check => check.status === 'BLOCKED') ? 'BLOCKED'
      : checks.some(check => check.status === 'WARN') ? 'WARN' : 'PASS') as Status,
    checks,
    sessionEvidence: { status: 'UNAVAILABLE' as const, verifiedAt: null, ageMs: null },
    writeSafety: 'NOT_ESTABLISHED' as const
  })
  if (!input.authorized) {
    add('ownership', 'BLOCKED', 'WORKSPACE_UNAVAILABLE', 'Create or resume an authorized workspace and run preflight again.')
    return report()
  }
  add('ownership', 'PASS', 'WORKSPACE_AUTHORIZED', 'Recheck authorization when performing the action.')
  if (!input.tab) add('tab', 'BLOCKED', 'TAB_UNAVAILABLE', 'Select a tab in this workspace and run preflight again.')
  else if (input.tab.sleeping) add('tab', 'WARN', 'TAB_SLEEPING', 'Wake the intended tab explicitly, then obtain a fresh snapshot.')
  else if (input.tab.loading) add('tab', 'WARN', 'TAB_LOADING', 'Wait for navigation to settle, then obtain a fresh snapshot.')
  else add('tab', 'PASS', 'TAB_AVAILABLE', 'Inspect a fresh snapshot before a consequential action.')

  let expectedOrigin: string | null = null
  if (input.expectedOrigin !== undefined) {
    expectedOrigin = webOrigin(input.expectedOrigin)
    // Only a web origin is a valid expectation; never accept paths, query
    // parameters, credentials, or fragments as an identity assertion.
    if (expectedOrigin) {
      const parsed = new URL(input.expectedOrigin)
      if (parsed.pathname !== '/' || parsed.search || parsed.hash) expectedOrigin = null
    }
    if (!expectedOrigin) add('origin', 'BLOCKED', 'EXPECTED_ORIGIN_INVALID', 'Supply an HTTP or HTTPS origin without credentials, path, query, or fragment.')
    else if (input.tab && webOrigin(input.tab.url) === expectedOrigin) {
      add('origin', 'PASS', 'ORIGIN_MATCHED', 'Verify the intended page and action using fresh evidence.')
    } else add('origin', 'WARN', 'ORIGIN_UNEXPECTED', 'Inspect the visible tab and reconcile the expected origin before continuing.')
  } else add('origin', 'WARN', 'ORIGIN_NOT_SPECIFIED', 'Supply the expected origin to check the intended destination.')

  const destination = expectedOrigin ?? input.tab?.url
  if (!destination) add('policy', 'WARN', 'POLICY_NOT_EVALUATED', 'Select a tab or supply a valid expected origin, then run preflight again.')
  else {
    let allowed = false
    try { allowed = evaluateWorkspaceNavigation(input.policy, destination).allowed } catch { /* Unknown policy fails closed. */ }
    add('policy', allowed ? 'PASS' : 'BLOCKED', allowed ? 'SITE_ALLOWED' : 'SITE_BLOCKED',
      allowed ? 'Site permission does not establish that an action is safe.' : 'Ask the operator to review site permissions or choose an allowed destination.')
  }
  if (input.paused) add('human', 'BLOCKED', 'USER_PAUSED', 'Ask the operator to inspect the page and resume agents; then obtain a fresh snapshot.')
  else if (input.attentionRequired) add('human', 'BLOCKED', 'HUMAN_STEP_REQUIRED', 'Wait for the operator to complete the requested step, then obtain a fresh snapshot.')
  else add('human', 'PASS', 'NO_PENDING_HUMAN_STEP', 'Respect any subsequent pause or human-attention request.')
  // Hronaut has no verified account-identity source. Reachability or a cookie
  // existing is not session evidence, and callers cannot assert it as a fact.
  add('session', 'WARN', 'SESSION_UNVERIFIED', 'Have the operator verify the intended session when needed; do not infer sign-in from browser reachability.')
  return report()
}
