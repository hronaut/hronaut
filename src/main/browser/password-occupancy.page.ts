import type { InspectionTarget } from './page-scripts/element-inspection.page.js'

interface PasswordOccupancyHandle { settle: () => boolean; cleanup: () => void }

type PasswordOccupancyPage = typeof globalThis & { __hronautPasswordOccupancy?: Map<string, PasswordOccupancyHandle> }

/**
 * Runs only in the trusted element-inspection isolated world: whether the one password field the target names is
 * empty. No value, length or DOM object leaves the page. The handle kept for settlement retains only identity, a
 * fixed enum, and temporary invalidation observers (at most eight, five seconds).
 */
export function passwordOccupancyInPage(element: Element, target: InspectionTarget, token: string): 'empty' | 'nonempty' | 'unknown' {
  const page = globalThis as PasswordOccupancyPage
  const handles = page.__hronautPasswordOccupancy ??= new Map()
  if (handles.size >= 8) throw new Error('Password occupancy is busy')
  const matches = document.querySelectorAll(target.ref
    ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector as string)
  if (matches.length !== 1 || matches[0] !== element) throw new Error('Password occupancy requires one unique target')
  const getter = (name: string): ((this: HTMLInputElement) => unknown) | undefined => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, name)?.get
  const valueGetter = getter('value'), typeGetter = getter('type')
  const eligible = (): boolean => element instanceof HTMLInputElement && element.isConnected
    && element.getRootNode() === document && typeof typeGetter === 'function'
    && Reflect.apply(typeGetter, element, []) === 'password'
    && !/(?:^|\s)(?:one-time-code|cc-\S+)(?:\s|$)/i.test(element.getAttribute('autocomplete') || '')
    && !element.isContentEditable
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
  let dirty = false
  const invalidate = (): void => { dirty = true; typeObserver.disconnect(); treeObserver.disconnect() }
  const typeObserver = new MutationObserver(invalidate)
  const treeObserver = new MutationObserver(invalidate)
  typeObserver.observe(element, { attributes: true, attributeFilter: ['type', 'autocomplete'] })
  // Conservatively reject any tree change; do not walk or retain mutation payloads.
  treeObserver.observe(document, { childList: true, subtree: true })
  const cleanup = (): void => { typeObserver.disconnect(); treeObserver.disconnect(); clearTimeout(timer); handles.delete(token) }
  const settle = (): boolean => {
    try {
      const changed = dirty || typeObserver.takeRecords().length > 0 || treeObserver.takeRecords().length > 0
      const current = document.querySelectorAll(target.ref
        ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector as string)
      return !changed && element.isConnected && current.length === 1 && current[0] === element
        && (!wasEligible || eligible())
    } finally { cleanup() }
  }
  const wasEligible = eligible()
  let state: 'empty' | 'nonempty' | 'unknown' = 'unknown'
  try {
    if (wasEligible && typeof valueGetter === 'function') {
      state = Reflect.apply(valueGetter, element, []) === '' ? 'empty' : 'nonempty'
    }
  } catch { state = 'unknown' }
  const timer = setTimeout(cleanup, 5_000)
  handles.set(token, { settle, cleanup })
  return state
}

/** Settles or cancels the password occupancy handle `token` names; false when there is none. */
export function passwordOccupancySettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as PasswordOccupancyPage).__hronautPasswordOccupancy?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
