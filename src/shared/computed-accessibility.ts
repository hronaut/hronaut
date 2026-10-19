export const COMPUTED_ACCESSIBILITY_LIMITS = {
  maxSelectorChars: 1_000,
  maxRefChars: 200,
  /** Text the element's name, description and value may draw on, as counted in the page before Chromium is asked. */
  maxTextChars: 100_000,
  /** Elements that text may come from: the element's subtree, open shadow trees, labels and referenced elements. */
  maxElements: 5_000,
  maxRoleChars: 64,
  maxTokenChars: 32
} as const

/**
 * The states Hronaut reports, by the type Chromium gives them. Values that can
 * hold what a person typed or chose, such as valuetext or valuenow, are left out.
 */
export const COMPUTED_ACCESSIBILITY_STATES = {
  busy: 'boolean',
  checked: 'tristate',
  disabled: 'boolean',
  editable: 'token',
  expanded: 'boolean',
  focusable: 'boolean',
  focused: 'boolean',
  hasPopup: 'token',
  invalid: 'token',
  level: 'integer',
  modal: 'boolean',
  multiline: 'boolean',
  multiselectable: 'boolean',
  orientation: 'token',
  pressed: 'tristate',
  readonly: 'boolean',
  required: 'boolean',
  selected: 'boolean',
  settable: 'boolean'
} as const
export type ComputedAccessibilityState = keyof typeof COMPUTED_ACCESSIBILITY_STATES

/** Why Chromium leaves an element out of its accessibility tree, by the codes Hronaut reports as they are. */
export const COMPUTED_ACCESSIBILITY_IGNORED_REASONS = [
  'activeModalDialog',
  'ariaHiddenElement',
  'ariaHiddenSubtree',
  'emptyAlt',
  'emptyText',
  'inertElement',
  'inertSubtree',
  'labelContainer',
  'labelFor',
  'notRendered',
  'notVisible',
  'presentationalRole',
  'probablyPresentational',
  'uninteresting'
] as const
export type ComputedAccessibilityIgnoredReason = typeof COMPUTED_ACCESSIBILITY_IGNORED_REASONS[number]

export type ComputedAccessibilityStateValue = boolean | 'mixed' | string | number

export interface ComputedAccessibilityReport {
  tabId: string
  /** Where the evidence comes from: Chromium's accessibility tree, not Hronaut's own element heuristics. */
  source: 'chromium-accessibility-tree'
  chromium: string
  /** Chromium's computed role, such as spinbutton or listbox; ignored elements report none. */
  role: string
  /** Whether Chromium leaves the element out of its accessibility tree. */
  ignored: boolean
  ignoredReasons: ComputedAccessibilityIgnoredReason[]
  /** Reasons Chromium gave that Hronaut does not report by name. */
  otherIgnoredReasons: number
  /** The allowlisted states Chromium reported, with their values. */
  states: Partial<Record<ComputedAccessibilityState, ComputedAccessibilityStateValue>>
  /** Allowlisted states Chromium did not report for this element, which is not the same as false. */
  notReported: ComputedAccessibilityState[]
  /** Reported states whose value did not have the expected type, so their value is left out. */
  unsupported: ComputedAccessibilityState[]
  caveats: string[]
}

export const COMPUTED_ACCESSIBILITY_CAVEATS = [
  'This is Chromium\'s computed accessibility for one element at the moment of the call. It is not what a particular screen reader announces, and not an accessibility conformance verdict.',
  'The element\'s accessible name, description and value are not returned, and neither are related elements or Chromium\'s node identifiers.',
  'Hronaut\'s own role and state fields in browser_element_inspect come from page heuristics and can differ; this report does not change them.'
] as const
