export type BrowserLiveRegionAction = 'start' | 'get' | 'stop' | 'clear'
export type BrowserLiveRegionStopReason =
  | 'stopped'
  | 'expired'
  | 'detached'
  | 'excluded'
  | 'total-char-limit'
  | 'observation-limit'
  | 'callback-limit'

export interface BrowserLiveRegionText {
  text: string
  empty: boolean
  truncated: boolean
}

export interface BrowserLiveRegionObservation extends BrowserLiveRegionText {
  index: number
  elapsedMs: number
  mutationRecords: number
  ariaBusy?: boolean
}

/** Authored attribute tokens only; never computed accessibility semantics. */
export interface BrowserLiveRegionMetadata {
  role?: 'alert' | 'log' | 'marquee' | 'progressbar' | 'region' | 'status' | 'timer'
  ariaLive?: 'off' | 'polite' | 'assertive'
  ariaAtomic?: boolean
  ariaRelevant?: Array<'additions' | 'removals' | 'text' | 'all'>
  ariaBusy?: boolean
}

export interface BrowserLiveRegionReport {
  tabId: string
  title: string
  url: string
  selector?: string
  startedAt?: string
  stoppedAt?: string
  stopReason?: BrowserLiveRegionStopReason
  active: boolean
  metadata?: BrowserLiveRegionMetadata
  initial?: BrowserLiveRegionText
  observations: BrowserLiveRegionObservation[]
  callbackCount: number
  unchangedCallbacks: number
  totalChars: number
  limits: {
    maxObservations: number
    maxObservationChars: number
    maxTotalChars: number
    maxNodesPerRead: number
    maxCallbacks: number
    maxDurationMs: number
  }
  caveats: string[]
}

export type BrowserDomChangesAction = 'start' | 'get' | 'stop' | 'clear'
export type BrowserDomChangeKind = 'child-list' | 'attributes' | 'text'

export interface BrowserDomChangeEntry {
  index: number
  kind: BrowserDomChangeKind
  occurredAt: string
  elapsedMs: number
  target: string
  occurrences: number
  attributeName?: string
  addedNodes?: number
  removedNodes?: number
  addedTags?: string[]
  removedTags?: string[]
}

export interface BrowserDomChangesReport {
  tabId: string
  title: string
  url: string
  startedAt?: string
  stoppedAt?: string
  active: boolean
  changeCount: number
  entries: BrowserDomChangeEntry[]
  truncated: boolean
  droppedChanges: number
  summary: {
    childList: number
    attributes: number
    text: number
    addedNodes: number
    removedNodes: number
  }
  caveats: string[]
}
