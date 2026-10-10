// DIAGNOSTIC BRANCH ONLY. Closed schema shared with the artifact exporter.
export const eventNames = ['installed', 'created', 'destroyed', 'navigation-start', 'navigation-commit',
  'load-start', 'load-stop', 'renderer-gone', 'add-enter', 'add-return', 'add-throw',
  'remove-enter', 'remove-return', 'remove-throw', 'bounds-enter', 'bounds-return', 'bounds-throw',
  'visible-enter', 'visible-return', 'visible-throw', 'capture-start', 'capture-success', 'capture-error',
  'presentation-start', 'presentation-frame', 'presentation-end', 'presentation-end-return', 'presentation-end-throw',
  'subscription-enter', 'subscription-return', 'subscription-throw', 'presentation-probe', 'active-fast-path',
  'clipboard-injection-hit', 'readiness-injection-hit', 'before-quit', 'will-quit', 'before-close'] as const
export type EventName = typeof eventNames[number]
export type Owner = 'foreground' | 'thumbnail' | 'presentation-probe' | 'other'
export type CaptureEvent = { event: EventName; ms: number } & Partial<Record<
  'id' | 'parent' | 'call' | 'active' | 'x' | 'y' | 'width' | 'height' | 'attachmentGeneration' |
  'layoutGeneration' | 'navigationGeneration' | 'imageWidth' | 'imageHeight' | 'preexisting', number>> &
  Partial<Record<'attached' | 'visible' | 'loading' | 'destroyed' | 'unknownViz' | 'empty' | 'mainFrame' | 'unavailable', boolean>> & { owner?: Owner }
const numbers = new Set(['ms', 'id', 'parent', 'call', 'active', 'x', 'y', 'width', 'height',
  'attachmentGeneration', 'layoutGeneration', 'navigationGeneration', 'imageWidth', 'imageHeight', 'preexisting'])
const booleans = new Set(['attached', 'visible', 'loading', 'destroyed', 'unknownViz', 'empty', 'mainFrame', 'unavailable'])
export function projectEvent(value: unknown): CaptureEvent | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (!eventNames.includes(row.event as EventName) || typeof row.ms !== 'number' || !Number.isFinite(row.ms)) return
  for (const [key, item] of Object.entries(row)) {
    if (key === 'event') continue
    if (numbers.has(key) && typeof item === 'number' && Number.isFinite(item)) continue
    if (booleans.has(key) && typeof item === 'boolean') continue
    if (key === 'owner' && typeof item === 'string' && ['foreground', 'thumbnail', 'presentation-probe', 'other'].includes(String(item))) continue
    return
  }
  return { ...row } as CaptureEvent
}
export class CaptureRing {
  events: CaptureEvent[] = []
  evicted = 0
  dropped = 0
  invalid = 0
  omittedContents = 0
  frozen = false
  beforeClose = false
  beforeQuit = false
  willQuit = false
  private post = 0
  record(row: CaptureEvent): void {
    if (row.event === 'before-close') this.beforeClose = true
    if (row.event === 'before-quit') this.beforeQuit = true
    if (row.event === 'will-quit') this.willQuit = true
    const projected = projectEvent(row)
    if (!projected) { this.invalid++; return }
    if (this.frozen && this.post >= 128) { this.dropped++; return }
    if (!this.frozen && this.events.length === 512) { this.events.shift(); this.evicted++ }
    this.events.push(projected)
    if (this.frozen) this.post++
    if (row.event === 'capture-error') this.frozen = true
  }
  snapshot() {
    return { events: [...this.events], evicted: this.evicted, dropped: this.dropped, invalid: this.invalid,
      omittedContents: this.omittedContents, frozen: this.frozen, beforeClose: this.beforeClose, beforeQuit: this.beforeQuit, willQuit: this.willQuit }
  }
}
export function projectSnapshot(value: unknown): ReturnType<CaptureRing['snapshot']> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const row = value as Record<string, unknown>
  if (Object.keys(row).sort().join(',') !== 'beforeClose,beforeQuit,dropped,events,evicted,frozen,invalid,omittedContents,willQuit') return
  if (!Array.isArray(row.events) || row.events.length > 640 || ['frozen', 'beforeClose', 'beforeQuit', 'willQuit'].some(key => typeof row[key] !== 'boolean')) return
  for (const key of ['evicted', 'dropped', 'invalid', 'omittedContents']) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) < 0) return
  }
  const events = row.events.map(projectEvent)
  if (events.some(event => !event)) return
  return { events: events as CaptureEvent[], evicted: row.evicted as number, dropped: row.dropped as number,
    invalid: row.invalid as number, omittedContents: row.omittedContents as number, frozen: row.frozen as boolean, beforeClose: row.beforeClose as boolean, beforeQuit: row.beforeQuit as boolean, willQuit: row.willQuit as boolean }
}
