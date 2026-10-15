export const CSS_STATE_PREVIEW_STATES = ['hover', 'active'] as const
export type CssStatePreviewState = typeof CSS_STATE_PREVIEW_STATES[number]

export const CSS_STATE_PREVIEW_LIMITS = {
  maxSelectorChars: 512,
  minDurationMs: 1_000,
  defaultDurationMs: 30_000,
  maxDurationMs: 60_000
} as const

export const CSS_STATE_PREVIEW_END_REASONS = [
  'cleared',
  'replaced',
  'expired',
  'human-reset',
  'navigation',
  'target-removed',
  'agent-paused',
  'workspace-control-changed',
  'devtools-opened',
  'debugger-detached',
  'tab-closed'
] as const
export type CssStatePreviewEndReason = typeof CSS_STATE_PREVIEW_END_REASONS[number]

export const CSS_STATE_PREVIEW_CAVEATS = [
  'This is a styling preview: Chromium matches the forced :hover or :active rules for one element. No pointer, click, focus or keyboard events are sent, activeElement and DOM attributes do not change, and it does not prove real interaction behavior, disabled semantics, accessibility or application outcomes.',
  'Changing matched CSS can still start transitions or animations, load resources referenced by the forced rules, or trigger page observers; it is not a side-effect-free boundary.',
  'Screenshots, element inspection and visual comparison taken while it is active report cssStatePreview so the rendering is not mistaken for natural page state.'
]

/** Normalize requested states to the supported order, rejecting anything else. */
export function normalizeCssStatePreviewStates(states: readonly string[]): CssStatePreviewState[] {
  if (!states.length) throw new Error('Choose at least one CSS state to preview: hover or active')
  const unsupported = states.find(state => !(CSS_STATE_PREVIEW_STATES as readonly string[]).includes(state))
  if (unsupported !== undefined) throw new Error('Only the hover and active CSS states can be previewed')
  return CSS_STATE_PREVIEW_STATES.filter(state => states.includes(state))
}

export function cssStatePreviewDuration(durationMs: number | undefined): number {
  const value = durationMs ?? CSS_STATE_PREVIEW_LIMITS.defaultDurationMs
  if (!Number.isInteger(value) || value < CSS_STATE_PREVIEW_LIMITS.minDurationMs || value > CSS_STATE_PREVIEW_LIMITS.maxDurationMs) {
    throw new Error(`durationMs must be an integer from ${CSS_STATE_PREVIEW_LIMITS.minDurationMs} to ${CSS_STATE_PREVIEW_LIMITS.maxDurationMs}`)
  }
  return value
}
