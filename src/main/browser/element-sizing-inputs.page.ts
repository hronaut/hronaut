import type { SIZING_INPUT_PROPERTIES } from '../../shared/element-sizing-inputs.js'
import type { InspectionTarget } from './page-scripts/element-inspection.page.js'

interface SizingInputsHandle { settle: () => boolean; cleanup: () => void }

type SizingInputsPage = typeof globalThis & { __hronautSizingInputs?: Map<string, SizingInputsHandle> }

/** What the page reports: the parsed sizing inputs, and the parent flex container context when it was asked for. */
export type SizingInputsPageResult = { sizingInputs: Record<string, string | number | null>; flexContainer?: unknown }

/**
 * Runs in the page: the one light-DOM element the target's selector matches, in a bounded document. It counts
 * elements only; it does not collect other nodes' attributes, text or styles.
 */
export function sizingLookupInPage(target: InspectionTarget): NodeListOf<Element> {
  if (!(document instanceof HTMLDocument)) throw Error('Sizing inputs require an HTML document')
  if (typeof target.selector !== 'string' || !target.selector.trim() || target.selector.length > 1000) throw Error('Sizing inputs require a bounded selector')
  const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT); let count = 0
  while (walker.nextNode()) { if (++count > 5000) throw Error('Sizing inputs require at most 5000 light-DOM elements') }
  const matches = document.querySelectorAll(target.selector)
  if (matches.length !== 1) throw Error('Sizing inputs require one unique light-DOM target')
  return matches
}

/**
 * Runs in the page: the element's computed sizing inputs, and its immediate parent's flex container context when
 * `includeFlexContainer` asks for it. Settlement then also requires the same parent, so a reparented element is not
 * published with another container's context.
 */
export function sizingInputsInPage(
  element: Element,
  target: InspectionTarget,
  token: string,
  properties: typeof SIZING_INPUT_PROPERTIES,
  includeFlexContainer: boolean,
  sizingLookup: (target: InspectionTarget) => NodeListOf<Element> | Element[],
  parse: (property: string, value: unknown) => string | number | null,
  flexContainerContext: (element: Element) => unknown
): SizingInputsPageResult {
  const handles = (globalThis as SizingInputsPage).__hronautSizingInputs ??= new Map()
  if (handles.size >= 8) throw Error('Sizing inputs inspection is busy')
  const parent = element.parentElement
  const unique = (): boolean => {
    const matches = sizingLookup(target)
    return matches.length === 1 && matches[0] === element && element.isConnected && element.getRootNode() === document
      && (!includeFlexContainer || element.parentElement === parent)
  }
  if (!unique()) throw Error('Sizing inputs require one unique light-DOM target')
  const style = getComputedStyle(element), result: Record<string, string | number | null> = {}
  for (const property of properties) result[property] = parse(property, style.getPropertyValue(property))
  const flexContainer = includeFlexContainer ? flexContainerContext(element) : undefined
  const cleanup = (): void => { clearTimeout(timer); handles.delete(token) }
  const settle = (): boolean => { try { return unique() } catch { return false } finally { cleanup() } }
  const timer = setTimeout(cleanup, 5000); handles.set(token, { settle, cleanup })
  return includeFlexContainer ? { sizingInputs: result, flexContainer } : { sizingInputs: result }
}

/** Settles or cancels the sizing inputs handle `token` names; false when there is none. */
export function sizingInputsSettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as SizingInputsPage).__hronautSizingInputs?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
