import {
  LOGPOINT_CAVEATS,
  LOGPOINT_LIMITS,
  type LogpointEndReason,
  type LogpointProbe,
  type LogpointReport
} from '../../../shared/logpoint.js'
import { redactNetworkUrl } from '../../../shared/network-details.js'

/** A tab's armed logpoints as a report shows them. */
export interface ArmedLogpoints {
  origin: string
  armedAt: number
  expiresAt: number
  probes: LogpointProbe[]
}

/** A tab's logpoints that ended, kept until the next add while the workspace's control is unchanged. */
export interface EndedLogpoints {
  origin: string
  reason: LogpointEndReason
  endedAt: string
  probes: LogpointProbe[]
}

/**
 * The tab's logpoints for one call. Page values reach only a call that may act on the origin they were
 * read on; any other call gets the logpoints with their records withheld.
 */
export function logpointReport(
  tab: { id: string; url: string },
  armed: ArmedLogpoints | undefined,
  ended: EndedLogpoints | undefined,
  authority: { assertCurrent(origin: string): void }
): LogpointReport {
  const base = { tabId: tab.id, url: redactNetworkUrl(tab.url), limits: LOGPOINT_LIMITS, caveats: [...LOGPOINT_CAVEATS] }
  const authorized = (origin: string): boolean => {
    try {
      authority.assertCurrent(origin)
      return true
    } catch {
      return false
    }
  }
  const withheld = (probes: LogpointProbe[]): LogpointProbe[] => probes.map(probe => ({ ...probe, records: [] }))
  if (armed) {
    const allowed = authorized(armed.origin)
    return {
      ...base,
      status: 'armed',
      origin: armed.origin,
      armedAt: new Date(armed.armedAt).toISOString(),
      expiresAt: new Date(armed.expiresAt).toISOString(),
      remainingMs: Math.max(0, armed.expiresAt - Date.now()),
      probes: allowed ? armed.probes : withheld(armed.probes),
      ...(allowed ? {} : { recordsWithheld: true })
    }
  }
  if (ended) {
    const allowed = authorized(ended.origin)
    return {
      ...base,
      status: 'ended',
      origin: ended.origin,
      probes: allowed ? ended.probes : withheld(ended.probes),
      ended: { reason: ended.reason, endedAt: ended.endedAt },
      ...(allowed ? {} : { recordsWithheld: true })
    }
  }
  return { ...base, status: 'idle', probes: [] }
}
