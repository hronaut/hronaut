/** The DOM change kinds a mutation source capture can wait for, as Chromium's DOM breakpoints name them. */
export const DOM_MUTATION_SOURCE_KINDS = ['attribute-modified', 'subtree-modified', 'node-removed'] as const
export type DomMutationSourceKind = typeof DOM_MUTATION_SOURCE_KINDS[number]

export const DOM_MUTATION_SOURCE_ACTIONS = ['arm', 'get', 'cancel'] as const
export type DomMutationSourceAction = typeof DOM_MUTATION_SOURCE_ACTIONS[number]

export const DOM_MUTATION_SOURCE_LIMITS = {
  maxSelectorChars: 512,
  minDurationMs: 1_000,
  defaultDurationMs: 30_000,
  maxDurationMs: 120_000,
  /** Stack frames kept in one capture, synchronous first, then asynchronous ones. */
  maxFrames: 20,
  maxFunctionNameChars: 120,
  maxUrlChars: 512,
  maxAsyncDescriptionChars: 40,
  /** Script URLs remembered while armed; frames of scripts past this have no URL. */
  maxScripts: 10_000
} as const

export const DOM_MUTATION_SOURCE_END_REASONS = [
  'captured',
  'cancelled',
  'replaced',
  'expired',
  'navigation',
  'target-removed',
  'authority-changed',
  'devtools-opened',
  'debugger-detached',
  'tab-closed'
] as const
export type DomMutationSourceEndReason = typeof DOM_MUTATION_SOURCE_END_REASONS[number]

export type DomMutationSourceStatus = 'idle' | 'armed' | 'captured' | 'expired' | 'cancelled' | 'invalidated'

/** What changed, as the breakpoint reported it. */
export type DomMutationSourceChange = 'attribute' | 'child-inserted' | 'child-removed' | 'node-removed'

export interface DomMutationSourceFrame {
  /** The function's name as the engine reports it, or "(anonymous)". */
  functionName: string
  /** The script's HTTP(S) URL without credentials, fragment or sensitive query values; absent for inline evaluated code, data:, blob: and other scripts. */
  url?: string
  /** 1-based, in the code the browser ran (generated code, not source maps). */
  lineNumber: number
  columnNumber: number
  /** Set on the first frame scheduled through an asynchronous step, naming it, such as setTimeout or Promise.then. */
  asyncBoundary?: string
}

export interface DomMutationSourceCapture {
  kind: DomMutationSourceKind
  change: DomMutationSourceChange
  capturedAt: string
  frames: DomMutationSourceFrame[]
  framesTruncated: boolean
}

export interface DomMutationSourceReport {
  tabId: string
  url: string
  status: DomMutationSourceStatus
  armed?: { selector: string; kind: DomMutationSourceKind; armedAt: string; expiresAt: string; remainingMs: number }
  capture?: DomMutationSourceCapture
  ended?: { selector: string; kind: DomMutationSourceKind; reason: DomMutationSourceEndReason; endedAt: string }
  limits: typeof DOM_MUTATION_SOURCE_LIMITS
  caveats: string[]
}

export const DOM_MUTATION_SOURCE_CAVEATS = [
  'While armed, the page runs with Hronaut\'s debugger enabled: the matching change and any debugger statement pause the page for a moment until Hronaut resumes it, which can change timing.',
  'The stack is where the change was made, which is often framework or library code rather than the component that asked for it. Positions are in the code the browser ran, without source maps.',
  'Only the first matching change is kept. A CSS-only state change such as :hover or :focus is not a DOM change and is never attributed.',
  'Locals, arguments, page text, markup, attribute and form values are never returned.'
]

export function domMutationSourceDuration(durationMs: number | undefined): number {
  const value = durationMs ?? DOM_MUTATION_SOURCE_LIMITS.defaultDurationMs
  if (!Number.isInteger(value) || value < DOM_MUTATION_SOURCE_LIMITS.minDurationMs || value > DOM_MUTATION_SOURCE_LIMITS.maxDurationMs) {
    throw new Error(`durationMs must be an integer from ${DOM_MUTATION_SOURCE_LIMITS.minDurationMs} to ${DOM_MUTATION_SOURCE_LIMITS.maxDurationMs}`)
  }
  return value
}
