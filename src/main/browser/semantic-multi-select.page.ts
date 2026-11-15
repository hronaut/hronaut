/** Why a semantic multi-select was refused, before any option changed. */
export type MultiSelectRejection = { ok: false; status: 'REJECTED'; effects: 'none'; retrySafe: false; reason: string }

/** A selection whose outcome the page's event handlers may have changed. */
export type MultiSelectUnknown = { ok: false; status: 'OUTCOME_UNKNOWN'; effects: 'possible'; retrySafe: false; reason: string }

export type MultiSelectResult = MultiSelectRejection | MultiSelectUnknown
  | { ok: true; status: 'SELECTED'; semantic: true; selectedCount: number; observed: 'immediate-native-state'; retrySafe: false }

/**
 * Runs in the multi-select isolated world: selects exactly the requested option values, and only them, in the one
 * native select[multiple] the target names, then checks after each event that the page's handlers left the selection
 * and target as written.
 */
export function multiSelectInPage(target: { ref?: string; selector?: string }, requested: string[], maxOptions: number, maxValueLength: number): MultiSelectResult {
  // Use Chromium's native disabledness, including optgroups through wrappers.
  // These intrinsics belong to the isolated world, not the page's prototypes.
  const nativeMatches = Element.prototype.matches
  const isDisabled = (element: Element): boolean => nativeMatches.call(element, ':disabled')
  const reject = (reason: string): MultiSelectRejection => ({ ok: false, status: 'REJECTED', effects: 'none', retrySafe: false, reason })
  const unknown = (): MultiSelectUnknown => ({ ok: false, status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false, reason: 'Selection or target changed during event handling; inspect fresh state without automatic replay' })
  const selector = target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector as string
  let matches: NodeListOf<Element>
  try { matches = document.querySelectorAll(selector) } catch { return reject('Invalid target selector') }
  if (matches.length !== 1) return reject('Target must identify exactly one element')
  const element = matches[0]
  if (!(element instanceof HTMLSelectElement) || !element.multiple) return reject('Target must be a native select[multiple]')
  if (isDisabled(element)) return reject('Target is natively disabled')
  if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible') return reject('Target is not visible')
  if (element.options.length > maxOptions) return reject('Select exceeds the 1000-option validation limit')
  const options = Array.from(element.options)
  const chosen = new Set<HTMLOptionElement>()
  const originalValues: string[] = []
  for (const option of options) {
    const value = option.value
    if (value.length > maxValueLength) return reject('Option value exceeds the 1024-unit validation limit')
    originalValues.push(value)
  }
  for (const value of requested) {
    const found = options.filter((_option, index) => originalValues[index] === value)
    if (found.length !== 1) return reject('Requested value is missing or ambiguous')
    const option = found[0]!
    if (isDisabled(option)) return reject('Requested option or option group is disabled')
    chosen.add(option)
  }
  // Clearing a previously selected disabled option is also a mutation of it.
  if (options.some(option => option.selected !== chosen.has(option) && isDisabled(option))) return reject('Selection would change a disabled option or group')
  const current = (): boolean => {
    if (!element.isConnected || document.querySelectorAll(selector).length !== 1 || document.querySelector(selector) !== element
      || !element.multiple || isDisabled(element) || element.options.length !== options.length) return false
    return options.every((option, index) => element.options[index] === option && option.selected === chosen.has(option)
      && option.value === originalValues[index]
      && (!chosen.has(option) || !isDisabled(option)))
  }
  // This isolated-world turn has no await, focus, scroll, or page callbacks
  // between whole-set validation and all native selected-property writes.
  const setter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected')!.set!
  for (const option of options) setter.call(option, chosen.has(option))
  element.dispatchEvent(new Event('input', { bubbles: true }))
  if (!current()) return unknown()
  element.dispatchEvent(new Event('change', { bubbles: true }))
  if (!current()) return unknown()
  return { ok: true, status: 'SELECTED', semantic: true, selectedCount: chosen.size, observed: 'immediate-native-state', retrySafe: false }
}
