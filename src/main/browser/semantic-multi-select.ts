export const MULTI_SELECT_WORLD_ID = 1021
export const MULTI_SELECT_LIMITS = { values: 50, valueLength: 1024, totalLength: 8192, options: 1000 } as const

export function normalizeSelectValues(values: unknown): string[] {
  if (!Array.isArray(values) || values.length > MULTI_SELECT_LIMITS.values
    || values.some(value => typeof value !== 'string' || value.length > MULTI_SELECT_LIMITS.valueLength)
    || values.reduce((total, value) => total + value.length, 0) > MULTI_SELECT_LIMITS.totalLength) {
    throw new Error('Provide at most 50 exact option values, each at most 1024 UTF-16 units and 8192 units in total')
  }
  if (new Set(values).size !== values.length) throw new Error('Duplicate requested option values are not allowed')
  return [...values].sort()
}

export function multiSelectScript(target: { ref?: string; selector?: string }, values: string[]): string {
  return `(() => {
    const target = ${JSON.stringify({ ref: target.ref, selector: target.selector })};
    const requested = ${JSON.stringify(values)};
    const reject = reason => ({ ok: false, status: 'REJECTED', effects: 'none', retrySafe: false, reason });
    const unknown = () => ({ ok: false, status: 'OUTCOME_UNKNOWN', effects: 'possible', retrySafe: false, reason: 'Selection or target changed during event handling; inspect fresh state without automatic replay' });
    const selector = target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector;
    let matches;
    try { matches = document.querySelectorAll(selector); } catch { return reject('Invalid target selector'); }
    if (matches.length !== 1) return reject('Target must identify exactly one element');
    const element = matches[0];
    if (!(element instanceof HTMLSelectElement) || !element.multiple) return reject('Target must be a native select[multiple]');
    if (element.matches(':disabled')) return reject('Target is natively disabled');
    if (!element.getClientRects().length || getComputedStyle(element).visibility !== 'visible') return reject('Target is not visible');
    if (element.options.length > ${MULTI_SELECT_LIMITS.options}) return reject('Select exceeds the 1000-option validation limit');
    const options = Array.from(element.options);
    const chosen = new Set();
    const originalValues = options.map(option => option.value);
    for (const value of requested) {
      const found = options.filter(option => option.value === value);
      if (found.length !== 1) return reject('Requested value is missing or ambiguous');
      const option = found[0];
      if (option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)) return reject('Requested option or option group is disabled');
      chosen.add(option);
    }
    // Clearing a previously selected disabled option is also a mutation of it.
    if (options.some(option => option.selected !== chosen.has(option) && (option.disabled || (option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled)))) return reject('Selection would change a disabled option or group');
    const current = () => {
      if (!element.isConnected || document.querySelectorAll(selector).length !== 1 || document.querySelector(selector) !== element
        || !element.multiple || element.matches(':disabled') || element.options.length !== options.length) return false;
      return options.every((option, index) => element.options[index] === option && option.selected === chosen.has(option)
        && option.value === originalValues[index]
        && (!chosen.has(option) || (!option.disabled && !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled))));
    };
    // This isolated-world turn has no await, focus, scroll, or page callbacks
    // between whole-set validation and all native selected-property writes.
    const setter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected').set;
    for (const option of options) setter.call(option, chosen.has(option));
    element.dispatchEvent(new Event('input', { bubbles: true }));
    if (!current()) return unknown();
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (!current()) return unknown();
    return { ok: true, status: 'SELECTED', semantic: true, selectedCount: chosen.size, observed: 'immediate-native-state', retrySafe: false };
  })()`
}
