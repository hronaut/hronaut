import type { DOM_CHANGES_LIMITS, DomChangesPageAction } from './dom-changes.js'
import type { BrowserDomChangeEntry, BrowserDomChangeKind, BrowserDomChangesReport } from './types.js'

/** The recording as the page reports it; main adds the tab, title, address and caveats. */
export type DomChangesPageResult = Omit<BrowserDomChangesReport, 'tabId' | 'title' | 'url' | 'caveats'>

type DomChangeBatch = Omit<BrowserDomChangeEntry, 'index' | 'occurredAt' | 'elapsedMs'>

interface DomChangesPageState {
  startedAt: string
  /** When the recording started, on the page's monotonic clock, which each change's elapsed time counts from. */
  startedAtPerf: number
  stoppedAt?: string
  active: boolean
  entries: BrowserDomChangeEntry[]
  changeCount: number
  truncated: boolean
  droppedChanges: number
  summary: BrowserDomChangesReport['summary']
  observer: MutationObserver | null
  recordMutations: ((records: MutationRecord[]) => void) | null
}

type DomChangesPage = typeof globalThis & { __hronautDomChangesV1?: DomChangesPageState }

/**
 * Runs in the DOM changes isolated world and records the shape of the document's changes: which elements changed, how
 * and how often, by tag path and attribute name only. It never reads page text, markup, field values, IDs, classes or
 * attribute values.
 */
export function domChangesInPage(action: DomChangesPageAction, limits: typeof DOM_CHANGES_LIMITS): DomChangesPageResult {
  const page = globalThis as DomChangesPage
  const key = '__hronautDomChangesV1'
  const bounded = (value: unknown, length: number): string => String(value || '').slice(0, length)
  const safeName = (value: unknown, length: number): string => bounded(value, length).replace(/[^a-zA-Z0-9_:.-]/g, '')
  const tagName = (node: Node | null | undefined): string => node && node.nodeType === Node.ELEMENT_NODE
    ? safeName((node as Element).localName || node.nodeName, limits.maxTagNameChars).toLowerCase()
    : ''
  const selectorFor = (node: Node): string => {
    let current: Element | null | undefined = node && node.nodeType === Node.ELEMENT_NODE ? node as Element : node?.parentElement
    const parts: string[] = []
    while (current && parts.length < 6) {
      const tag = tagName(current)
      if (!tag) break
      let index = 1
      let sibling = current.previousElementSibling
      while (sibling) {
        if (sibling.localName === current.localName) index += 1
        sibling = sibling.previousElementSibling
      }
      parts.unshift(tag + ':nth-of-type(' + index + ')')
      current = current.parentElement
    }
    return bounded(parts.join(' > '), limits.maxSelectorChars) || 'document'
  }
  const empty = (): DomChangesPageResult => ({
    active: false,
    changeCount: 0,
    entries: [],
    truncated: false,
    droppedChanges: 0,
    summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 }
  })
  const snapshot = (state: DomChangesPageState): DomChangesPageResult => ({
    startedAt: state.startedAt,
    ...(state.stoppedAt ? { stoppedAt: state.stoppedAt } : {}),
    active: state.active,
    changeCount: state.changeCount,
    entries: state.entries.map((entry) => ({ ...entry })),
    truncated: state.truncated,
    droppedChanges: state.droppedChanges,
    summary: { ...state.summary }
  })
  const previous = page[key]
  if (action === 'clear') {
    previous?.observer?.disconnect()
    delete page[key]
    return empty()
  }
  if (action === 'start') {
    previous?.observer?.disconnect()
    const state: DomChangesPageState = {
      startedAt: new Date().toISOString(),
      startedAtPerf: performance.now(),
      active: true,
      entries: [],
      changeCount: 0,
      truncated: false,
      droppedChanges: 0,
      summary: { childList: 0, attributes: 0, text: 0, addedNodes: 0, removedNodes: 0 },
      observer: null,
      recordMutations: null
    }
    const recordMutations = (records: MutationRecord[]) => {
      if (!state.active) return
      const batches = new Map<string, DomChangeBatch>()
      for (const record of records) {
        let kind: BrowserDomChangeKind
        const target = selectorFor(record.target)
        let attributeName: string | undefined
        let addedNodes = 0
        let removedNodes = 0
        let addedTags: string[] = []
        let removedTags: string[] = []
        if (record.type === 'childList') {
          kind = 'child-list'
          addedNodes = record.addedNodes.length
          removedNodes = record.removedNodes.length
          addedTags = Array.from(new Set(Array.from(record.addedNodes).map(tagName).filter(Boolean))).slice(0, limits.maxTagsPerEntry)
          removedTags = Array.from(new Set(Array.from(record.removedNodes).map(tagName).filter(Boolean))).slice(0, limits.maxTagsPerEntry)
          state.summary.childList += 1
          state.summary.addedNodes += addedNodes
          state.summary.removedNodes += removedNodes
        } else if (record.type === 'attributes') {
          kind = 'attributes'
          attributeName = safeName(record.attributeName, limits.maxAttributeNameChars) || 'attribute'
          state.summary.attributes += 1
        } else {
          kind = 'text'
          state.summary.text += 1
        }
        state.changeCount += 1
        const signature = [kind, target, attributeName || '', addedTags.join(','), removedTags.join(',')].join('|')
        const existing = batches.get(signature)
        if (existing) {
          existing.occurrences += 1
          existing.addedNodes = (existing.addedNodes || 0) + addedNodes
          existing.removedNodes = (existing.removedNodes || 0) + removedNodes
        } else {
          batches.set(signature, {
            kind,
            target,
            occurrences: 1,
            ...(attributeName ? { attributeName } : {}),
            ...(addedNodes ? { addedNodes } : {}),
            ...(removedNodes ? { removedNodes } : {}),
            ...(addedTags.length ? { addedTags } : {}),
            ...(removedTags.length ? { removedTags } : {})
          })
        }
      }
      const occurredAt = new Date().toISOString()
      const elapsedMs = Math.max(0, Math.round(performance.now() - state.startedAtPerf))
      for (const batch of batches.values()) {
        if (state.entries.length >= limits.maxEntries) {
          state.truncated = true
          state.droppedChanges += batch.occurrences
          continue
        }
        state.entries.push({
          index: state.entries.length + 1,
          occurredAt,
          elapsedMs,
          ...batch
        })
      }
    }
    const observer = new MutationObserver(recordMutations)
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true })
    state.observer = observer
    state.recordMutations = recordMutations
    page[key] = state
    return snapshot(state)
  }
  const state = page[key]
  if (!state) return empty()
  if (action === 'stop' && state.active) {
    const pending = state.observer?.takeRecords() || []
    if (pending.length) state.recordMutations?.(pending)
    state.observer?.disconnect()
    state.active = false
    state.stoppedAt = new Date().toISOString()
  }
  return snapshot(state)
}
