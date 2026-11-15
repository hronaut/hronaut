import type { BrowserImageState } from '../../shared/types.js'

interface ImageStateHandle { settle: () => boolean; cleanup: () => void }

type ImageStatePage = typeof globalThis & { __hronautImageState?: Map<string, ImageStateHandle> }

/** Why the page could not read the image; main maps each to its message. */
export type ImageStateFailure = 'expired' | 'unsupported-document' | 'busy' | 'document-limit' | 'invalid-selector'
  | 'missing-target' | 'ambiguous-target' | 'unsupported-target' | 'native-unavailable'

/**
 * Runs in the image state isolated world: the native facts of the one top-level HTML image the selector matches, in a
 * bounded document, through the isolated world's own DOM methods. Only scalars and a boolean reduction of the selected
 * source cross IPC. The handle kept for settlement lives until the deadline.
 */
export function imageStateInPage(selector: string, token: string, deadline: number): BrowserImageState | { failure: ImageStateFailure } {
  if (Date.now() > deadline) return { failure: 'expired' }
  if (!(document instanceof HTMLDocument)) return { failure: 'unsupported-document' }
  const doc = document, handles = (globalThis as ImageStatePage).__hronautImageState ??= new Map()
  if (handles.size >= 8) return { failure: 'busy' }
  const query = Document.prototype.querySelectorAll, createWalker = Document.prototype.createTreeWalker, next = TreeWalker.prototype.nextNode
  const lookup = (): NodeListOf<Element> & { failure?: undefined } | { failure: ImageStateFailure } => {
    const walker = Reflect.apply(createWalker, doc, [doc, NodeFilter.SHOW_ELEMENT]); let count = 0
    while (Reflect.apply(next, walker, [])) { if (++count > 5000) return { failure: 'document-limit' } }
    try { return Reflect.apply(query, doc, [selector]) } catch { return { failure: 'invalid-selector' } }
  }
  const matches = lookup(); if (matches.failure) return matches
  if (matches.length === 0) return { failure: 'missing-target' }
  if (matches.length !== 1) return { failure: 'ambiguous-target' }
  const element = matches[0]
  if (!(element instanceof HTMLImageElement) || !element.isConnected || element.getRootNode() !== doc) return { failure: 'unsupported-target' }
  const read = (name: string): unknown => {
    const getter = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, name)?.get
    if (typeof getter !== 'function') throw Error(); return Reflect.apply(getter, element, [])
  }
  let timer: ReturnType<typeof setTimeout> | undefined = undefined; const cleanup = (): void => { clearTimeout(timer); handles.delete(token) }
  try {
    const complete = read('complete'), naturalWidth = read('naturalWidth'), naturalHeight = read('naturalHeight'), source = read('currentSrc')
    if (typeof complete !== 'boolean' || typeof source !== 'string' || ![naturalWidth, naturalHeight].every(n => Number.isSafeInteger(n) && (n as number) >= 0 && (n as number) <= 4294967295)) throw Error()
    // Native currentSrc can materialize a large string here. Only its boolean
    // reduction crosses IPC; this is not a pre-allocation or CPU bound.
    const result: BrowserImageState = { observedAt: Date.now(), complete, naturalWidth: naturalWidth as number, naturalHeight: naturalHeight as number, hasSelectedSource: source.length !== 0 }
    const settle = (): boolean => {
      try {
        if (Date.now() > deadline || document !== doc) return false
        const current = lookup(); return !current.failure && element.isConnected && element.getRootNode() === doc && current.length === 1 && current[0] === element
      } finally { cleanup() }
    }
    timer = setTimeout(cleanup, Math.max(1, deadline - Date.now())); handles.set(token, { settle, cleanup }); return result
  } catch { cleanup(); return { failure: 'native-unavailable' } }
}

/** Settles or cancels the image state handle `token` names; false when there is none. */
export function imageStateSettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as ImageStatePage).__hronautImageState?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
