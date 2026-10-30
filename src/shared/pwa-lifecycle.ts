import { pageScript } from './page-script.js'
import { pwaLifecycleReadInPage, pwaLifecycleStartInPage } from './pwa-lifecycle.page.js'

/** The English caveats a service-worker capture carries; MCP results keep them and the panel names them in the interface language. */
export const PWA_LIFECYCLE_CAVEATS = {
  observedTimes: 'Observed callback times are not historical lifecycle timestamps. Capture always has incomplete history.',
  polling: 'Registration discovery polls once per second; early transitions and short-lived registrations may be missed.',
  scope: 'Registrations belong to this top-level origin and workspace, not exclusively to this tab.',
  identities: 'Worker identities are local to this capture and distinguish versions at the same script URL.',
  interruption: 'Navigation, reload, closure, debugger loss or authority loss interrupts capture. Stopping or interruption can omit undrained events.',
  limits: 'At most 100 events, 20 registrations, 100 workers and two minutes; five captures retained in memory, oldest stopped first.',
  longUrls: 'URLs exceeding 2048 characters are omitted rather than partially exposing a credential-bearing URL.',
  metadataOnly: 'Only metadata is observed. No worker updates, messages, activation, cache clearing, permission changes or worker execution requests.',
  sleeping: 'Sleeping or frozen tabs are not awakened. Sleep or freeze interrupts capture instead of keeping the page active.',
  snapshot: 'Reads return the last drained snapshot. No complete-history or universal worker-lifetime guarantee is made.'
} as const

export const PWA_LIFECYCLE_LIMITS = {
  events: 100,
  registrations: 20,
  workers: 100,
  durationMs: 120_000,
  discoveryMs: 1_000,
  captures: 5,
  urlChars: 2_048
} as const

export type PwaLifecycleAction = 'start' | 'get' | 'stop' | 'clear'
export interface PwaLifecycleOptions {
  tabId?: string
  captureId?: string
  action: PwaLifecycleAction
}
export interface PwaLifecycleWorker {
  id: number
  scriptUrl: string
  state: string
}
export interface PwaLifecycleEvent {
  kind: string
  observedAt: number
  scope?: string
  worker: PwaLifecycleWorker | null
  controller: PwaLifecycleWorker | null
  installing?: PwaLifecycleWorker | null
  waiting?: PwaLifecycleWorker | null
  active?: PwaLifecycleWorker | null
}
export interface PwaLifecyclePageSnapshot {
  active: boolean
  reason: string | null
  startedAt: number
  stoppedAt: number | null
  events: PwaLifecycleEvent[]
  truncated: boolean
  missingHistory: true
}
export interface PwaLifecycleReport extends PwaLifecyclePageSnapshot {
  captureId: string
  tabId: string
  origin: string
  interrupted: boolean
  lastDrainedAt: number | null
  coverage: 'observed-only'
  caveats: string[]
}

/** Runs in a dedicated isolated world; never invokes worker lifecycle actions. */
export function pwaLifecyclePageScript(action: 'start' | 'get' | 'stop', id: string): string {
  if (action !== 'start') return pageScript(pwaLifecycleReadInPage, id, action === 'stop')
  return pageScript(pwaLifecycleStartInPage, id, PWA_LIFECYCLE_LIMITS)
}
