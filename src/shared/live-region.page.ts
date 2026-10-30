import type { LIVE_REGION_LIMITS, LiveRegionErrorCode, LiveRegionPageAction } from './live-region.js'
import type {
  BrowserLiveRegionMetadata,
  BrowserLiveRegionObservation,
  BrowserLiveRegionReport,
  BrowserLiveRegionStopReason,
  BrowserLiveRegionText
} from './types.js'

/** What the page answers: the recording as main reports it without the tab, limits and caveats, or why a start failed. */
export type LiveRegionPageResult =
  | { error: LiveRegionErrorCode }
  | Omit<BrowserLiveRegionReport, 'tabId' | 'title' | 'url' | 'limits' | 'caveats'>

interface LiveRegionPageState {
  selector: string
  region: Element | null
  startedAt: string
  startedAtMs: number
  stoppedAt?: string
  stopReason?: BrowserLiveRegionStopReason
  active: boolean
  metadata: BrowserLiveRegionMetadata
  initial: BrowserLiveRegionText
  observations: BrowserLiveRegionObservation[]
  callbackCount: number
  unchangedCallbacks: number
  totalChars: number
  lastText: string
  lastTruncated: boolean
  observer: MutationObserver | null
  timer: ReturnType<typeof setTimeout> | 0
}

type LiveRegionPage = typeof globalThis & { __hronautLiveRegionV1?: LiveRegionPageState }

/**
 * Runs in the live region's isolated world and records the text of one selected region at each MutationObserver
 * callback. Reads are bounded by node and character budgets before any whole-subtree string exists, and never touch
 * form values, editable content, frames, shadow roots, scripts or styles.
 */
export function liveRegionInPage(action: LiveRegionPageAction, selector: string, limits: typeof LIVE_REGION_LIMITS): LiveRegionPageResult {
  const page = globalThis as LiveRegionPage
  const key = '__hronautLiveRegionV1'
  const excludedTags = new Set(['script', 'style', 'noscript', 'template', 'textarea', 'input', 'select', 'option', 'datalist', 'iframe', 'frame', 'frameset', 'object', 'embed', 'canvas', 'video', 'audio'])
  const blockTags = new Set(['address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul'])
  const roles = new Set(['alert', 'log', 'marquee', 'progressbar', 'region', 'status', 'timer'])
  const editable = (element: Element) => element.hasAttribute('contenteditable') && element.getAttribute('contenteditable') !== 'false'
  const excluded = (element: Element) => excludedTags.has(element.localName) || editable(element)
  const token = (element: Element, name: string, allowed: string[]): string | undefined => {
    const value = String(element.getAttribute(name) || '').trim().toLowerCase()
    return allowed.includes(value) ? value : undefined
  }
  const metadataFor = (element: Element): BrowserLiveRegionMetadata => {
    const metadata: BrowserLiveRegionMetadata = {}
    const role = String(element.getAttribute('role') || '').trim().toLowerCase().split(/\s+/)[0]!
    if (roles.has(role)) metadata.role = role as NonNullable<BrowserLiveRegionMetadata['role']>
    const live = token(element, 'aria-live', ['off', 'polite', 'assertive'])
    if (live) metadata.ariaLive = live as NonNullable<BrowserLiveRegionMetadata['ariaLive']>
    const atomic = token(element, 'aria-atomic', ['true', 'false'])
    if (atomic) metadata.ariaAtomic = atomic === 'true'
    const relevant = String(element.getAttribute('aria-relevant') || '').trim().toLowerCase().split(/\s+/)
      .filter((value, index, values) => ['additions', 'removals', 'text', 'all'].includes(value) && values.indexOf(value) === index)
      .slice(0, 4)
    if (relevant.length) metadata.ariaRelevant = relevant as NonNullable<BrowserLiveRegionMetadata['ariaRelevant']>
    const busy = token(element, 'aria-busy', ['true', 'false'])
    if (busy) metadata.ariaBusy = busy === 'true'
    return metadata
  }
  // Bounded depth-first read: the node and character budgets stop work before a whole-subtree string is built.
  const readText = (root: Element): BrowserLiveRegionText => {
    const rawBudget = limits.maxObservationChars * 2
    let raw = ''
    let nodes = 0
    let truncated = false
    let node: Node | null = root.firstChild
    while (node && node !== root) {
      if (++nodes > limits.maxNodesPerRead) { truncated = true; break }
      let descend = false
      if (node.nodeType === Node.TEXT_NODE) {
        const remaining = rawBudget - raw.length
        if ((node as Text).length > remaining) {
          raw += (node as Text).substringData(0, Math.max(0, remaining))
          truncated = true
          break
        }
        raw += (node as Text).data
      } else if (node.nodeType === Node.ELEMENT_NODE && !excluded(node as Element)) {
        if (blockTags.has((node as Element).localName)) raw += ' '
        descend = true
      }
      if (descend && node.firstChild) { node = node.firstChild; continue }
      while (node && node !== root && !node.nextSibling) {
        node = node.parentNode
        if (node && node !== root && node.nodeType === Node.ELEMENT_NODE && blockTags.has((node as Element).localName)) raw += ' '
      }
      if (!node || node === root) break
      node = node.nextSibling
    }
    let text = raw.replace(/\s+/g, ' ').trim()
    if (text.length > limits.maxObservationChars) {
      text = text.slice(0, limits.maxObservationChars)
      truncated = true
    }
    return { text, empty: text.length === 0, truncated }
  }
  // The region can become editable, enter design mode or move into a shadow tree after start,
  // so eligibility is checked again before every read, not only when recording starts.
  const ineligible = (region: Element): '' | 'detached' | 'excluded' => {
    if (!region.isConnected) return 'detached'
    if (region.getRootNode() !== document || document.designMode === 'on' || (region as HTMLElement).isContentEditable === true) return 'excluded'
    let steps = 0
    for (let element: Element | null = region; element; element = element.parentElement) {
      if (++steps > limits.maxNodesPerRead || excluded(element)) return 'excluded'
    }
    return ''
  }
  // Mutations inside excluded descendants are not counted, so counts reveal nothing about typing there.
  const insideExcluded = (node: Node, region: Element | null): boolean => {
    let element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
    let steps = 0
    while (element && element !== region) {
      if (++steps > limits.maxNodesPerRead || excluded(element)) return true
      element = element.parentElement
    }
    return false
  }
  const empty = (): LiveRegionPageResult => ({ active: false, observations: [], callbackCount: 0, unchangedCallbacks: 0, totalChars: 0 })
  const snapshot = (state: LiveRegionPageState): LiveRegionPageResult => ({
    selector: state.selector,
    startedAt: state.startedAt,
    ...(state.stoppedAt ? { stoppedAt: state.stoppedAt, stopReason: state.stopReason } : {}),
    active: state.active,
    metadata: { ...state.metadata },
    initial: { ...state.initial },
    observations: state.observations.map((observation) => ({ ...observation })),
    callbackCount: state.callbackCount,
    unchangedCallbacks: state.unchangedCallbacks,
    totalChars: state.totalChars
  })
  // Stopping disconnects the observer and drops the element reference, so a later read can never rebind.
  const stop = (state: LiveRegionPageState, reason: BrowserLiveRegionStopReason) => {
    if (!state.active) return
    state.active = false
    state.observer!.disconnect()
    state.observer = null
    clearTimeout(state.timer)
    state.region = null
    state.stoppedAt = new Date().toISOString()
    state.stopReason = reason
  }
  const previous = page[key]
  if (previous) {
    const reason = previous.active ? ineligible(previous.region!) : ''
    if (reason) stop(previous, reason)
    if (previous.active && Date.now() - previous.startedAtMs >= limits.maxDurationMs) stop(previous, 'expired')
  }
  if (action === 'clear') {
    if (previous) stop(previous, 'stopped')
    delete page[key]
    return empty()
  }
  if (action === 'get') return previous ? snapshot(previous) : empty()
  if (action === 'stop') {
    if (!previous) return empty()
    stop(previous, 'stopped')
    return snapshot(previous)
  }
  if (previous) stop(previous, 'stopped')
  delete page[key]
  if (!selector || selector.length > limits.maxSelectorChars) return { error: 'invalid-selector' }
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(selector)
  } catch {
    return { error: 'invalid-selector' }
  }
  if (matches.length === 0) return { error: 'not-found' }
  if (matches.length > 1) return { error: 'not-unique' }
  const region = matches[0]!
  if (region === document.documentElement || region === document.head || region === document.body) return { error: 'too-broad' }
  if (ineligible(region)) return { error: 'excluded-region' }
  const startedAtMs = Date.now()
  const startedAtPerf = performance.now()
  const initial = readText(region)
  const state: LiveRegionPageState = {
    selector,
    region,
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    active: true,
    metadata: metadataFor(region),
    initial,
    observations: [],
    callbackCount: 0,
    unchangedCallbacks: 0,
    totalChars: initial.text.length,
    lastText: initial.text,
    lastTruncated: initial.truncated,
    observer: null,
    timer: 0
  }
  state.observer = new MutationObserver((records) => {
    if (!state.active) return
    const reason = ineligible(state.region!)
    if (reason) { stop(state, reason); return }
    const relevant = records.filter((record) => !insideExcluded(record.target, state.region))
    if (!relevant.length) return
    state.callbackCount += 1
    if (state.callbackCount > limits.maxCallbacks) { stop(state, 'callback-limit'); return }
    const read = readText(state.region!)
    // Only the bounded text is observable; a change beyond it reads as unchanged.
    if (read.text === state.lastText && read.truncated === state.lastTruncated) { state.unchangedCallbacks += 1; return }
    if (state.totalChars + read.text.length > limits.maxTotalChars) { stop(state, 'total-char-limit'); return }
    state.lastText = read.text
    state.lastTruncated = read.truncated
    state.totalChars += read.text.length
    const busy = token(state.region!, 'aria-busy', ['true', 'false'])
    state.observations.push({
      index: state.observations.length + 1,
      elapsedMs: Math.round(performance.now() - startedAtPerf),
      text: read.text,
      empty: read.empty,
      truncated: read.truncated,
      mutationRecords: relevant.length,
      ...(busy ? { ariaBusy: busy === 'true' } : {})
    })
    if (state.observations.length >= limits.maxObservations) stop(state, 'observation-limit')
  })
  state.observer.observe(region, { childList: true, subtree: true, characterData: true })
  state.timer = setTimeout(() => stop(state, 'expired'), limits.maxDurationMs)
  page[key] = state
  return snapshot(state)
}
