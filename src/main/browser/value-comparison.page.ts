import type { BrowserValueComparison } from '../../shared/value-comparison.js'
import type { InspectionTarget } from './page-scripts/element-inspection.page.js'

interface ValueComparisonHandle { settle: () => boolean; cleanup: () => void }

type ValueComparisonPage = typeof globalThis & { __hronautValueComparison?: Map<string, ValueComparisonHandle> }

/**
 * Runs in the existing trusted inspection isolated world: whether the one text field the target selects holds exactly
 * `expected`. The native value is reduced to match or mismatch there; no value, length, prefix or position leaves the
 * page, and the caller's expected text is never echoed.
 */
export function valueComparisonInPage(element: Element, target: InspectionTarget, token: string, expected: string, maxLength: number): BrowserValueComparison {
  const handles = (globalThis as ValueComparisonPage).__hronautValueComparison ??= new Map()
  if (handles.size >= 8) throw Error('Value comparison is busy')
  const matches = document.querySelectorAll(target.selector as string)
  if (matches.length !== 1 || matches[0] !== element) throw Error('Value comparison requires one unique target')
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
    : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : null
  const read = (prototype: object, object: unknown, name: string): unknown => {
    const getter = Object.getOwnPropertyDescriptor(prototype, name)?.get
    if (typeof getter !== 'function') throw Error('Native accessor unavailable')
    return Reflect.apply(getter, object, [])
  }
  // Same customized built-in refusal as form validity: unknown API behavior fails closed.
  const uncustomized = (): boolean => {
    if (!prototype) return false
    try { Reflect.apply(HTMLElement.prototype.attachInternals, element, []); return false }
    catch (error) {
      return error instanceof DOMException
        && read(DOMException.prototype, error, 'name') === 'NotSupportedError'
        && read(DOMException.prototype, error, 'message')
          === "Failed to execute 'attachInternals' on 'HTMLElement': Unable to attach ElementInternals to non-custom elements."
    }
  }
  const eligible = (): boolean => Boolean(prototype) && element.isConnected && element.getRootNode() === document
    && !element.hasAttribute('is') && !element.hasAttribute('hidden') && !(element as HTMLElement).isContentEditable
    && uncustomized()
    && (!(element instanceof HTMLInputElement) || read(HTMLInputElement.prototype, element, 'type') === 'text')
    && !/(?:^|\s)(?:one-time-code|cc-\S+)(?:\s|$)/i.test(element.getAttribute('autocomplete') || '')
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
  let dirty = false
  const invalidate = (): void => { dirty = true; typeObserver.disconnect(); treeObserver.disconnect() }
  const typeObserver = new MutationObserver(invalidate), treeObserver = new MutationObserver(invalidate)
  typeObserver.observe(element, { attributes: true, attributeFilter: ['type', 'autocomplete', 'is', 'hidden', 'contenteditable'] })
  treeObserver.observe(document, { childList: true, subtree: true })
  const cleanup = (): void => { typeObserver.disconnect(); treeObserver.disconnect(); clearTimeout(timer); handles.delete(token) }
  let wasEligible = false, result: BrowserValueComparison = { status: 'unavailable', reason: 'unsupported-target' }
  try {
    wasEligible = eligible()
    if (wasEligible) {
      const value = read(prototype!, element, 'value')
      if (typeof value !== 'string') throw Error('Invalid native value')
      result = value.length > maxLength ? { status: 'unavailable', reason: 'oversized' }
        : { status: value === expected ? 'match' : 'mismatch' }
    }
  } catch { result = { status: 'unavailable', reason: 'native-unavailable' } }
  const settle = (): boolean => {
    try {
      const changed = dirty || typeObserver.takeRecords().length > 0 || treeObserver.takeRecords().length > 0
      const current = document.querySelectorAll(target.selector as string)
      return !changed && element.isConnected && current.length === 1 && current[0] === element && (!wasEligible || eligible())
    } catch { return false } finally { cleanup() }
  }
  const timer = setTimeout(cleanup, 5000); handles.set(token, { settle, cleanup }); return result
}

/** Settles or cancels the value comparison handle `token` names; false when there is none. */
export function valueComparisonSettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as ValueComparisonPage).__hronautValueComparison?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
