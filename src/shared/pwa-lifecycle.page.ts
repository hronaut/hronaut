import type { PWA_LIFECYCLE_LIMITS, PwaLifecycleEvent, PwaLifecyclePageSnapshot, PwaLifecycleWorker } from './pwa-lifecycle.js'

/** What a capture reads in the page: its snapshot and the counts the tests check its bounds with. */
export interface PwaLifecyclePageState extends PwaLifecyclePageSnapshot {
  scans: number
  listenerCount: number
  registrations: number
  workerCount: number
}

interface PwaLifecycleCapture {
  id: string
  stop: (reason: string) => void
  read: () => PwaLifecyclePageState
}

type PwaLifecyclePage = typeof globalThis & { __hronautPwaLifecycle?: PwaLifecycleCapture }

/** Runs in the capture's isolated world: reads captureId's snapshot, stopping the capture first when stop is set. */
export function pwaLifecycleReadInPage(captureId: string, stop: boolean): PwaLifecyclePageState | null {
  const page = globalThis as PwaLifecyclePage
  const state = page.__hronautPwaLifecycle
  if (state?.id !== captureId) return null
  if (stop) state.stop('stopped')
  const snapshot = state.read()
  if (stop) delete page.__hronautPwaLifecycle
  return snapshot
}

/**
 * Runs in the capture's isolated world: starts capture captureId, replacing any other, and records what the page's service
 * worker registrations and workers do until a limit or the duration ends it. It only listens and polls, and never
 * invokes a worker lifecycle action.
 */
export async function pwaLifecycleStartInPage(captureId: string, config: typeof PWA_LIFECYCLE_LIMITS): Promise<PwaLifecyclePageState> {
  const page = globalThis as PwaLifecyclePage
  const maxEvents = config.events
  const maxRegistrations = config.registrations
  const maxWorkers = config.workers
  const durationMs = config.durationMs
  const pollMs = config.discoveryMs
  if (page.__hronautPwaLifecycle?.id === captureId) return page.__hronautPwaLifecycle.read()
  page.__hronautPwaLifecycle?.stop('replaced')
  const events: PwaLifecycleEvent[] = []
  const cleanup: Array<() => void> = []
  const registrations = new Map<ServiceWorkerRegistration, boolean>()
  const workers = new WeakMap<ServiceWorker, number>()
  let active = true, reason: string | null = null, discoveryBusy = false, nextWorker = 1
  // Set once the capture starts; stop clears them, also when it ends the capture before that.
  const timers: { poll?: ReturnType<typeof setInterval>; deadline?: ReturnType<typeof setTimeout> } = {}
  let scans = 0, truncated = false, stoppedAt: number | null = null
  const startedAt = Date.now()
  const stop = (value: string): void => {
    if (!active) return
    active = false; reason = value; stoppedAt = Date.now()
    clearInterval(timers.poll); clearTimeout(timers.deadline)
    for (const remove of cleanup.splice(0)) remove()
  }
  const listen = (target: EventTarget, name: string, handler: () => void): void => {
    if (!active) return
    target.addEventListener(name, handler)
    cleanup.push(() => target.removeEventListener(name, handler))
  }
  const boundedUrl = (value: unknown): string => {
    const text = String(value)
    if (text.length > config.urlChars) { truncated = true; return '' }
    return text
  }
  const identity = (worker: ServiceWorker | null | undefined): PwaLifecycleWorker | null => {
    if (!worker) return null
    let id = workers.get(worker)
    if (!id) {
      if (nextWorker > maxWorkers) { truncated = true; stop('worker-limit'); return null }
      id = nextWorker++; workers.set(worker, id)
    }
    return { id, scriptUrl: boundedUrl(worker.scriptURL), state: worker.state }
  }
  const record = (kind: string, registration?: ServiceWorkerRegistration, worker?: ServiceWorker | null): void => {
    if (!active) return
    const event: PwaLifecycleEvent = { kind, observedAt: Date.now(), worker: identity(worker), controller: identity(navigator.serviceWorker.controller) }
    if (registration) Object.assign(event, { scope: boundedUrl(registration.scope), installing: identity(registration.installing), waiting: identity(registration.waiting), active: identity(registration.active) })
    if (!active) return
    events.push(event)
    if (events.length >= maxEvents) { truncated = true; stop('event-limit') }
  }
  const watchedWorkers = new WeakSet<ServiceWorker>()
  const watchWorker = (worker: ServiceWorker | null | undefined, registration?: ServiceWorkerRegistration): void => {
    if (!active || !worker || watchedWorkers.has(worker)) return
    watchedWorkers.add(worker); identity(worker)
    listen(worker, 'statechange', () => record('statechange', registration, worker))
  }
  const watchRegistration = (registration: ServiceWorkerRegistration, initial: boolean): void => {
    if (!active) return
    if (registrations.has(registration)) {
      if (!registrations.get(registration)) { registrations.set(registration, true); record('registration-discovered', registration) }
      return
    }
    if (registrations.size >= maxRegistrations) { truncated = true; stop('registration-limit'); return }
    registrations.set(registration, true)
    for (const worker of [registration.installing, registration.waiting, registration.active]) watchWorker(worker, registration)
    listen(registration, 'updatefound', () => { watchWorker(registration.installing, registration); record('updatefound', registration, registration.installing) })
    record(initial ? 'registration-initial' : 'registration-discovered', registration)
  }
  const scan = async (initial: boolean): Promise<void> => {
    if (!active || discoveryBusy) return
    discoveryBusy = true
    try {
      const found = await navigator.serviceWorker.getRegistrations()
      if (!active) return
      scans++
      const current = new Set(found)
      for (const [registration, present] of registrations) {
        if (present && !current.has(registration)) { registrations.set(registration, false); record('registration-removed', registration) }
        if (!active) return
      }
      for (const registration of found) { watchRegistration(registration, initial); if (!active) break }
    } catch { if (active) stop('discovery-unavailable') } finally { discoveryBusy = false }
  }
  const read = (): PwaLifecyclePageState => ({ active, reason, startedAt, stoppedAt, events: events.map(event => ({ ...event })), scans, truncated, missingHistory: true, listenerCount: cleanup.length, registrations: registrations.size, workerCount: nextWorker - 1 })
  page.__hronautPwaLifecycle = { id: captureId, stop, read }
  if (!('serviceWorker' in navigator)) { stop('unsupported'); return read() }
  listen(navigator.serviceWorker, 'controllerchange', () => { watchWorker(navigator.serviceWorker.controller); record('controllerchange') })
  watchWorker(navigator.serviceWorker.controller)
  timers.deadline = setTimeout(() => stop('duration-limit'), durationMs)
  timers.poll = setInterval(() => void scan(false), pollMs)
  record('initial')
  await scan(true)
  return read()
}
