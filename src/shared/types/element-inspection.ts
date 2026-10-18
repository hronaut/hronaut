import type { CssInspectionProperty } from '../css-provenance.js'

export interface BrowserElementInspectionOptions {
  /** Compared in the page and never returned; requires one unique selector. */
  expectedValue?: string
  includeSizingInputs?: boolean
  /** Adds the immediate parent's flex container context; implies includeSizingInputs. */
  includeFlexContainer?: boolean
  includeValidity?: boolean
  includePasswordOccupancy?: boolean
  tabId?: string
  ref?: string
  selector?: string
  cssProperties?: CssInspectionProperty[]
  includeFonts?: boolean
  includeScroll?: boolean
}

export interface BrowserElementBoxEdges {
  top: number
  right: number
  bottom: number
  left: number
}

export interface BrowserCssProvenance {
  status: 'candidates' | 'unavailable'
  reason?: string
  properties: CssInspectionProperty[]
  computed: Array<{ property: CssInspectionProperty; value: string | null }>
  candidates: Array<{
    property: CssInspectionProperty
    value: string | null
    valueOmitted?: boolean
    kind: 'rule' | 'inline' | 'attributes'
    inheritanceDepth: number
    important: boolean
    disabled: boolean
    selector?: string
    origin: string
    conditions: Array<{ type: string; text: string | null }>
    source?: { url: string; line?: number; column?: number; precision?: 'declaration' | 'rule' }
  }>
  truncated: boolean
  caveats: string[]
}

export interface BrowserRenderedFonts {
  status: 'observed' | 'empty' | 'unavailable'
  reason?: 'debugger-in-use' | 'unsupported-protocol' | 'unsupported-target'
  scope: 'selected-leaf-element'
  capturedAt: string
  fonts: Array<{ familyName: string | null; postScriptName: string | null; isCustomFont: boolean; glyphCount: number }>
  truncated: boolean
}

export type BrowserScrollGeometry = {
  status: 'observed'
  scrollTop: number
  scrollLeft: number
  clientWidth: number
  clientHeight: number
  scrollWidth: number
  scrollHeight: number
  direction: 'ltr' | 'rtl'
  writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | 'sideways-rl' | 'sideways-lr'
  isDocumentScroller: boolean
  documentScroller: 'html' | 'body' | null
} | { status: 'unavailable'; reason: 'unsupported-cssom' | 'invalid-or-out-of-range' }

export type BrowserFormValidity = {
  status: 'observed'
  willValidate: boolean
  validity: Record<'valueMissing' | 'typeMismatch' | 'patternMismatch' | 'tooLong' | 'tooShort' | 'rangeUnderflow' | 'rangeOverflow' | 'stepMismatch' | 'badInput' | 'customError' | 'valid', boolean>
} | { status: 'unavailable'; reason: 'unsupported-target' | 'native-unavailable' }

export interface BrowserElementInspection {
  valueComparison?: import('../value-comparison.js').BrowserValueComparison
  sizingInputs?: import('../element-sizing-inputs.js').BrowserSizingInputs
  flexContainer?: import('../element-flex-container.js').BrowserFlexContainerContext
  formValidity?: BrowserFormValidity
  passwordOccupancy?: 'empty' | 'nonempty' | 'unknown'
  scrollGeometry?: BrowserScrollGeometry
  cssProvenance?: BrowserCssProvenance
  renderedFonts?: BrowserRenderedFonts
  tabId: string
  title: string
  url: string
  capturedAt: string
  selector: string
  tag: string
  text?: string
  attributes: Array<{ name: string; value: string }>
  box: {
    x: number
    y: number
    width: number
    height: number
    contentWidth: number
    contentHeight: number
    boxSizing: string
    margin: BrowserElementBoxEdges
    border: BrowserElementBoxEdges
    padding: BrowserElementBoxEdges
  }
  layout: {
    display: string
    position: string
    zIndex: string
    visibility: string
    opacity: string
    overflowX: string
    overflowY: string
    flexDirection?: string
    alignItems?: string
    justifyContent?: string
    gridTemplateColumns?: string
    gridTemplateRows?: string
  }
  typography: {
    color: string
    backgroundColor: string
    fontFamily: string
    fontSize: string
    fontWeight: string
    lineHeight: string
    letterSpacing: string
    textAlign: string
    whiteSpace: string
    contrastRatio?: number
  }
  accessibility: {
    role: string
    name: string
    focusable: boolean
    focused?: boolean
    focusWithin?: boolean
    disabled: boolean
    checked?: boolean | 'mixed'
  }
  caveats: string[]
}

export type BrowserCssStatePreviewAction = 'set' | 'get' | 'clear'

export interface BrowserCssStatePreviewSummary {
  states: Array<'hover' | 'active'>
  selector: string
  startedAt: string
  expiresAt: string
}

export interface BrowserCssStatePreviewReport {
  tabId: string
  title: string
  url: string
  /** reset-uncertain: Hronaut could not confirm the override was removed; clear again or reload. */
  status: 'active' | 'inactive' | 'reset-uncertain'
  preview?: BrowserCssStatePreviewSummary & { remainingMs: number; resetUncertain?: boolean }
  lastEnded?: {
    reason: import('../css-state-preview.js').CssStatePreviewEndReason
    endedAt: string
    clean: boolean
  }
  limits: {
    states: Array<'hover' | 'active'>
    maxSelectorChars: number
    minDurationMs: number
    defaultDurationMs: number
    maxDurationMs: number
  }
  caveats: string[]
}

/** Native element state only: does not establish audible output or autoplay-policy outcome. */
export interface BrowserMediaState {
  kind: 'audio' | 'video'
  observedAt: number
  paused: boolean
  ended: boolean
  seeking: boolean
  muted: boolean
  volume: number
  playbackRate: number
  currentTime: number
  duration: { state: 'unknown' | 'infinite' } | { state: 'finite'; seconds: number }
  readyState: number
  networkState: number
  errorCode: number | null
}

/** Sampled native image facts, not decoded pixels or publication-time DOM identity. */
export interface BrowserImageState {
  observedAt: number
  complete: boolean
  naturalWidth: number
  naturalHeight: number
  hasSelectedSource: boolean
}
