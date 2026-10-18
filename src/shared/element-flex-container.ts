/** Why the selected element's immediate flex container context was not reported. */
export const FLEX_CONTAINER_UNAVAILABLE_REASONS = [
  'no-parent',
  'shadow-host-or-custom-element',
  'native-or-anonymous-container',
  'item-not-rendered',
  'item-display-contents',
  'item-out-of-flow',
  'not-flex-container'
] as const
export type FlexContainerUnavailableReason = typeof FLEX_CONTAINER_UNAVAILABLE_REASONS[number]

/**
 * The computed layout inputs of the selected element's parent when that parent
 * is an ordinary flex container, and its measured content size. Computed
 * values the report does not support are null rather than guessed.
 */
export type BrowserFlexContainerContext = {
  status: 'observed'
  display: 'flex' | 'inline-flex'
  flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse' | null
  flexWrap: 'nowrap' | 'wrap' | 'wrap-reverse' | null
  rowGap: string | null
  columnGap: string | null
  direction: 'ltr' | 'rtl' | null
  writingMode: 'horizontal-tb' | 'vertical-rl' | 'vertical-lr' | 'sideways-rl' | 'sideways-lr' | null
  /**
   * The parent's client size minus its padding, in physical CSS pixels (width is horizontal whatever the flex
   * direction or writing mode): scrollbars and borders excluded, rounded by the browser. Null for the root element
   * and a quirks-mode body, whose client size is the viewport's.
   */
  contentWidth: number | null
  contentHeight: number | null
} | { status: 'unavailable'; reason: FlexContainerUnavailableReason }

const MAX_FLEX_CONTAINER_PX = 1_000_000_000

// Also serialized into the isolated world: keep this function self-contained.
// It reads the element, its parent and their computed styles only: no siblings, text, attributes or custom properties.
export function flexContainerContext(element: Element): unknown {
  const parent = element.parentElement
  if (!parent) return { status: 'unavailable', reason: 'no-parent' }
  // A shadow root lays light-DOM children out in its own tree, so the parent's box may not hold them.
  // A closed root cannot be seen from a page script; custom elements are where such roots usually live.
  if (parent.shadowRoot || parent.localName.includes('-')) return { status: 'unavailable', reason: 'shadow-host-or-custom-element' }
  // These lay their children out in an anonymous inner box or a user-agent shadow tree, and SVG has no flex layout.
  if (parent.namespaceURI !== 'http://www.w3.org/1999/xhtml' || ['button', 'details', 'fieldset', 'select'].includes(parent.localName)) {
    return { status: 'unavailable', reason: 'native-or-anonymous-container' }
  }
  const item = getComputedStyle(element)
  if (item.display === 'none') return { status: 'unavailable', reason: 'item-not-rendered' }
  if (item.display === 'contents') return { status: 'unavailable', reason: 'item-display-contents' }
  // Under a hidden ancestor, unslotted, or fallback content of a replaced element: no box to lay out.
  if (!element.checkVisibility()) return { status: 'unavailable', reason: 'item-not-rendered' }
  if (item.position === 'absolute' || item.position === 'fixed') return { status: 'unavailable', reason: 'item-out-of-flow' }
  const style = getComputedStyle(parent)
  if (style.display !== 'flex' && style.display !== 'inline-flex') return { status: 'unavailable', reason: 'not-flex-container' }
  const pixels = (value: string): number => /^-?[0-9]+(?:\.[0-9]+)?px$/.test(value) ? Number(value.slice(0, -2)) : Number.NaN
  // Only CSS keywords and lengths cross to the main process, as the sizing inputs do.
  const token = (value: string): string | null => /^(?:[a-z-]{1,32}|[0-9.]{1,24}(?:px|%))$/.test(value) ? value : null
  // CSSOM gives the root element, and the body in quirks mode, the viewport's client size.
  const viewportSized = parent === document.documentElement || (document.compatMode === 'BackCompat' && parent === document.body)
  return {
    status: 'observed',
    display: style.display,
    flexDirection: token(style.flexDirection),
    flexWrap: token(style.flexWrap),
    rowGap: token(style.rowGap),
    columnGap: token(style.columnGap),
    direction: token(style.direction),
    writingMode: token(style.writingMode),
    contentWidth: viewportSized ? null : parent.clientWidth - pixels(style.paddingLeft) - pixels(style.paddingRight),
    contentHeight: viewportSized ? null : parent.clientHeight - pixels(style.paddingTop) - pixels(style.paddingBottom)
  }
}

function keyword<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null
}

function gap(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 32) return null
  if (value === 'normal') return value
  const match = /^(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(px|%)$/.exec(value)
  return match && Number(value.slice(0, -match[1]!.length)) <= MAX_FLEX_CONTAINER_PX ? value : null
}

function size(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_FLEX_CONTAINER_PX) return null
  return Math.round(value * 100) / 100
}

export function normalizeFlexContainer(raw: unknown): BrowserFlexContainerContext {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  if (object.status !== 'observed') {
    const reason = keyword(object.reason, FLEX_CONTAINER_UNAVAILABLE_REASONS)
    return { status: 'unavailable', reason: reason ?? 'not-flex-container' }
  }
  const display = keyword(object.display, ['flex', 'inline-flex'] as const)
  if (!display) return { status: 'unavailable', reason: 'not-flex-container' }
  return {
    status: 'observed',
    display,
    flexDirection: keyword(object.flexDirection, ['row', 'row-reverse', 'column', 'column-reverse'] as const),
    flexWrap: keyword(object.flexWrap, ['nowrap', 'wrap', 'wrap-reverse'] as const),
    rowGap: gap(object.rowGap),
    columnGap: gap(object.columnGap),
    direction: keyword(object.direction, ['ltr', 'rtl'] as const),
    writingMode: keyword(object.writingMode, ['horizontal-tb', 'vertical-rl', 'vertical-lr', 'sideways-rl', 'sideways-lr'] as const),
    contentWidth: size(object.contentWidth),
    contentHeight: size(object.contentHeight)
  }
}
