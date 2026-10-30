import type { FORM_VALIDITY_FLAGS } from '../../shared/form-validity.js'
import type { InspectionTarget } from './page-scripts/element-inspection.page.js'

interface FormValidityHandle { settle: () => boolean; cleanup: () => void }

type FormValidityPage = typeof globalThis & { __hronautFormValidity?: Map<string, FormValidityHandle> }

/** The field's native validity as the page reports it; main checks every flag again before using it. */
export type FormValidityPageResult =
  | { status: 'observed'; willValidate: boolean; validity: Record<string, boolean> }
  | { status: 'unavailable'; reason: 'unsupported-target' | 'native-unavailable' }

/**
 * Runs in the existing trusted inspection isolated world: the native validity flags of the one form field the target
 * selects. Only fixed native booleans cross IPC; no value, constraint string or validation message is read.
 */
export function formValidityInPage(element: Element, target: InspectionTarget, token: string, flags: typeof FORM_VALIDITY_FLAGS): FormValidityPageResult {
  const handles = (globalThis as FormValidityPage).__hronautFormValidity ??= new Map()
  if (handles.size >= 8) throw Error('Form validity inspection is busy')
  const matches = document.querySelectorAll(target.selector as string)
  if (matches.length !== 1 || matches[0] !== element) throw Error('Form validity requires one unique target')
  const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype
    : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : null
  const read = (prototype: object, object: unknown, name: string): unknown => {
    const getter = Object.getOwnPropertyDescriptor(prototype, name)?.get
    if (typeof getter !== 'function') throw Error('Native accessor unavailable')
    return Reflect.apply(getter, object, [])
  }
  // On these three native brands attachInternals must throw before mutation:
  // HTML's steps 1/3 distinguish internal is-value from a non-custom control.
  // Chromium's exact non-custom refusal is the only accepted result. Unknown
  // wording/API behavior fails closed. No validation message or value is read.
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
    && (!(element instanceof HTMLInputElement) || !['password', 'file', 'hidden'].includes(read(HTMLInputElement.prototype, element, 'type') as string))
    && !/(?:^|\s)(?:one-time-code|cc-\S+)(?:\s|$)/i.test(element.getAttribute('autocomplete') || '')
    && element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0
  let dirty = false
  const invalidate = (): void => { dirty = true; typeObserver.disconnect(); treeObserver.disconnect() }
  const typeObserver = new MutationObserver(invalidate), treeObserver = new MutationObserver(invalidate)
  typeObserver.observe(element, { attributes: true, attributeFilter: ['type', 'autocomplete', 'is', 'hidden', 'contenteditable'] })
  treeObserver.observe(document, { childList: true, subtree: true })
  const cleanup = (): void => { typeObserver.disconnect(); treeObserver.disconnect(); clearTimeout(timer); handles.delete(token) }
  let wasEligible = false, result: FormValidityPageResult = { status: 'unavailable', reason: 'unsupported-target' }
  try {
    wasEligible = eligible()
    if (wasEligible) {
      const willValidate = read(prototype!, element, 'willValidate')
      const nativeValidity = read(prototype!, element, 'validity')
      if (typeof willValidate !== 'boolean') throw Error('Invalid native boolean')
      const validity: Record<string, boolean> = {}
      for (const key of flags) {
        const value = read(ValidityState.prototype, nativeValidity, key)
        if (typeof value !== 'boolean') throw Error('Invalid native boolean')
        validity[key] = value
      }
      result = { status: 'observed', willValidate, validity }
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

/** Settles or cancels the form validity handle `token` names; false when there is none. */
export function formValiditySettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as FormValidityPage).__hronautFormValidity?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
