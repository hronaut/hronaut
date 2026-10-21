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
}

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
  if (action !== 'start') return `(() => {
    const state = globalThis.__hronautPwaLifecycle;
    if (state?.id !== ${JSON.stringify(id)}) return null;
    ${action === 'stop' ? "state.stop('stopped');" : ''}
    const snapshot = state.read();
    ${action === 'stop' ? 'delete globalThis.__hronautPwaLifecycle;' : ''}
    return snapshot;
  })()`
  return `(async () => {
  const config = ${JSON.stringify(PWA_LIFECYCLE_LIMITS)};
  const maxEvents = config.events;
  const maxRegistrations = config.registrations;
  const maxWorkers = config.workers;
  const durationMs = config.durationMs;
  const pollMs = config.discoveryMs;
  if (globalThis.__hronautPwaLifecycle?.id === ${JSON.stringify(id)}) return globalThis.__hronautPwaLifecycle.read();
  globalThis.__hronautPwaLifecycle?.stop('replaced');
  const events = [], cleanup = [], registrations = new Map(), workers = new WeakMap();
  let active = true, reason = null, discoveryBusy = false, nextWorker = 1, timer, deadline;
  let scans = 0, truncated = false, stoppedAt = null;
  const startedAt = Date.now();
  const stop = value => {
    if (!active) return;
    active = false; reason = value; stoppedAt = Date.now();
    clearInterval(timer); clearTimeout(deadline);
    for (const remove of cleanup.splice(0)) remove();
  };
  const listen = (target, name, handler) => {
    if (!active) return;
    target.addEventListener(name, handler);
    cleanup.push(() => target.removeEventListener(name, handler));
  };
  const boundedUrl = value => {
    const text = String(value);
    if (text.length > config.urlChars) { truncated = true; return ''; }
    return text;
  };
  const identity = worker => {
    if (!worker) return null;
    let id = workers.get(worker);
    if (!id) {
      if (nextWorker > maxWorkers) { truncated = true; stop('worker-limit'); return null; }
      id = nextWorker++; workers.set(worker, id);
    }
    return { id, scriptUrl: boundedUrl(worker.scriptURL), state: worker.state };
  };
  const record = (kind, registration, worker) => {
    if (!active) return;
    const event = { kind, observedAt: Date.now(), worker: identity(worker), controller: identity(navigator.serviceWorker.controller) };
    if (registration) Object.assign(event, { scope: boundedUrl(registration.scope), installing: identity(registration.installing), waiting: identity(registration.waiting), active: identity(registration.active) });
    if (!active) return;
    events.push(event);
    if (events.length >= maxEvents) { truncated = true; stop('event-limit'); }
  };
  const watchedWorkers = new WeakSet();
  const watchWorker = (worker, registration) => {
    if (!active || !worker || watchedWorkers.has(worker)) return;
    watchedWorkers.add(worker); identity(worker);
    listen(worker, 'statechange', () => record('statechange', registration, worker));
  };
  const watchRegistration = (registration, initial) => {
    if (!active) return;
    if (registrations.has(registration)) {
      if (!registrations.get(registration)) { registrations.set(registration, true); record('registration-discovered', registration); }
      return;
    }
    if (registrations.size >= maxRegistrations) { truncated = true; stop('registration-limit'); return; }
    registrations.set(registration, true);
    for (const worker of [registration.installing, registration.waiting, registration.active]) watchWorker(worker, registration);
    listen(registration, 'updatefound', () => { watchWorker(registration.installing, registration); record('updatefound', registration, registration.installing); });
    record(initial ? 'registration-initial' : 'registration-discovered', registration);
  };
  const scan = async initial => {
    if (!active || discoveryBusy) return;
    discoveryBusy = true;
    try {
      const found = await navigator.serviceWorker.getRegistrations();
      if (!active) return;
      scans++;
      const current = new Set(found);
      for (const [registration, present] of registrations) {
        if (present && !current.has(registration)) { registrations.set(registration, false); record('registration-removed', registration); }
        if (!active) return;
      }
      for (const registration of found) { watchRegistration(registration, initial); if (!active) break; }
    } catch { if (active) stop('discovery-unavailable'); }
    finally { discoveryBusy = false; }
  };
  const read = () => ({ active, reason, startedAt, stoppedAt, events: events.map(event => ({ ...event })), scans, truncated, missingHistory: true, listenerCount: cleanup.length, registrations: registrations.size, workerCount: nextWorker - 1 });
  globalThis.__hronautPwaLifecycle = { id: ${JSON.stringify(id)}, stop, read };
  if (!('serviceWorker' in navigator)) { stop('unsupported'); return read(); }
  listen(navigator.serviceWorker, 'controllerchange', () => { watchWorker(navigator.serviceWorker.controller); record('controllerchange'); });
  watchWorker(navigator.serviceWorker.controller);
  deadline = setTimeout(() => stop('duration-limit'), durationMs);
  timer = setInterval(() => void scan(false), pollMs);
  record('initial');
  await scan(true);
  return read();
})()
`
}
