export interface PendingPasswordOccupancy {
  finish(): Promise<void>
  assertCurrent(): void
  discard(): void
}

// This source runs only in the trusted element-inspection isolated world.
// No value, length or DOM object leaves the page. Handles retain only identity,
// a fixed enum, and temporary invalidation observers (at most eight, five seconds).
export function passwordOccupancySource(token: string): string {
  return `(() => {
    const token = ${JSON.stringify(token)};
    const key = '__hronautPasswordOccupancy';
    const handles = globalThis[key] ??= new Map();
    if (handles.size >= 8) throw new Error('Password occupancy is busy');
    const matches = document.querySelectorAll(target.ref
      ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector);
    if (matches.length !== 1 || matches[0] !== element) throw new Error('Password occupancy requires one unique target');
    const getter = (name) => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, name)?.get;
    const valueGetter = getter('value'), typeGetter = getter('type');
    const eligible = () => element instanceof HTMLInputElement && element.isConnected
      && element.getRootNode() === document && typeof typeGetter === 'function'
      && Reflect.apply(typeGetter, element, []) === 'password'
      && !/(?:^|\\s)(?:one-time-code|cc-\\S+)(?:\\s|$)/i.test(element.getAttribute('autocomplete') || '')
      && !element.isContentEditable
      && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
      && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
    let dirty = false;
    const invalidate = () => { dirty = true; typeObserver.disconnect(); treeObserver.disconnect(); };
    const typeObserver = new MutationObserver(invalidate);
    const treeObserver = new MutationObserver(invalidate);
    typeObserver.observe(element, { attributes: true, attributeFilter: ['type', 'autocomplete'] });
    // Conservatively reject any tree change; do not walk or retain mutation payloads.
    treeObserver.observe(document, { childList: true, subtree: true });
    let timer;
    const cleanup = () => { typeObserver.disconnect(); treeObserver.disconnect(); clearTimeout(timer); handles.delete(token); };
    const settle = () => {
      try {
        const changed = dirty || typeObserver.takeRecords().length > 0 || treeObserver.takeRecords().length > 0;
        const current = document.querySelectorAll(target.ref
          ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector);
        return !changed && element.isConnected && current.length === 1 && current[0] === element
          && (!wasEligible || eligible());
      } finally { cleanup(); }
    };
    const wasEligible = eligible();
    let state = 'unknown';
    try {
      if (wasEligible && typeof valueGetter === 'function') {
        state = Reflect.apply(valueGetter, element, []) === '' ? 'empty' : 'nonempty';
      }
    } catch { state = 'unknown'; }
    timer = setTimeout(cleanup, 5_000);
    handles.set(token, { settle, cleanup });
    return state;
  })()`
}

export function passwordOccupancySettlementScript(token: string, cancel = false): string {
  return `(() => {
    const handle = globalThis.__hronautPasswordOccupancy?.get(${JSON.stringify(token)});
    ${cancel ? 'handle?.cleanup(); return false;' : 'return handle ? handle.settle() : false;'}
  })()`
}
