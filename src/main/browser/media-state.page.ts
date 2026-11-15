import type { BrowserMediaState } from '../../shared/types.js'

interface MediaStateHandle { settle: () => boolean; cleanup: () => void }

type MediaStatePage = typeof globalThis & { __hronautMediaState?: Map<string, MediaStateHandle> }

/** Why the page could not read the media element; main maps each to its message. */
export type MediaStateFailure = 'busy' | 'invalid-selector' | 'non-unique-target' | 'unsupported-target' | 'native-unavailable'

/**
 * Runs in the media state isolated world: the native state of the one media element the selector matches. Only native
 * scalar values are reduced here, before IPC. No source URL, error message, track, metadata or media content is
 * acquired. The handle kept for settlement rejects detach and reinsert, and replacement, ABA included.
 */
export function mediaStateInPage(target: { selector: string }, token: string): BrowserMediaState | { failure: MediaStateFailure } {
  const handles = (globalThis as MediaStatePage).__hronautMediaState ??= new Map()
  if (handles.size >= 8) return { failure: 'busy' }
  const selector = target.selector
  let matches: NodeListOf<Element>
  try { matches = document.querySelectorAll(selector) } catch { return { failure: 'invalid-selector' } }
  if (matches.length !== 1) return { failure: 'non-unique-target' }
  const element = matches[0]
  if (!(element instanceof HTMLMediaElement) || !element.isConnected || element.getRootNode() !== document) {
    return { failure: 'unsupported-target' }
  }
  const read = (name: string): unknown => {
    const getter = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, name)?.get
    if (typeof getter !== 'function') throw Error('Media state unavailable: native accessor')
    return Reflect.apply(getter, element, [])
  }
  const boolean = (name: string): boolean => { const value = read(name); if (typeof value !== 'boolean') throw Error('Media state unavailable: invalid scalar'); return value }
  const number = (name: string, min: number, max: number, integer = false): number => {
    const value = read(name)
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw Error('Media state unavailable: invalid scalar')
    return value
  }
  let dirty = false
  const observer = new MutationObserver(() => { dirty = true; observer.disconnect() })
  // Reject detach/reinsert and replacement, including ABA, without retaining mutation records.
  observer.observe(document, { subtree: true, childList: true, attributes: true })
  let timer: ReturnType<typeof setTimeout> | undefined = undefined
  const cleanup = (): void => { observer.disconnect(); clearTimeout(timer); handles.delete(token) }
  try {
    const rawDuration = read('duration')
    let duration: BrowserMediaState['duration']
    if (Number.isNaN(rawDuration)) duration = { state: 'unknown' }
    else if (rawDuration === Infinity) duration = { state: 'infinite' }
    else if (typeof rawDuration === 'number' && Number.isFinite(rawDuration) && rawDuration >= 0 && rawDuration <= Number.MAX_SAFE_INTEGER) duration = { state: 'finite', seconds: rawDuration }
    else throw Error('Media state unavailable: invalid duration')
    const nativeError = read('error'); let errorCode: unknown = null
    if (nativeError !== null) {
      const getter = Object.getOwnPropertyDescriptor(MediaError.prototype, 'code')?.get
      if (typeof getter !== 'function') throw Error('Media state unavailable: native error accessor')
      errorCode = Reflect.apply(getter, nativeError, [])
      if (!Number.isInteger(errorCode) || (errorCode as number) < 1 || (errorCode as number) > 4) throw Error('Media state unavailable: invalid error code')
    }
    const result: BrowserMediaState = {
      kind: element instanceof HTMLVideoElement ? 'video' : 'audio', observedAt: Date.now(),
      paused: boolean('paused'), ended: boolean('ended'), seeking: boolean('seeking'), muted: boolean('muted'),
      volume: number('volume', 0, 1), playbackRate: number('playbackRate', -1024, 1024), currentTime: number('currentTime', 0, Number.MAX_SAFE_INTEGER),
      duration, readyState: number('readyState', 0, 4, true), networkState: number('networkState', 0, 3, true), errorCode: errorCode as number | null
    }
    if (JSON.stringify(result).length > 1024) throw Error('Media state unavailable: output limit')
    const settle = (): boolean => {
      try {
        const changed = dirty || observer.takeRecords().length > 0
        const current = document.querySelectorAll(selector)
        return !changed && element.isConnected && element.getRootNode() === document && current.length === 1 && current[0] === element
      } finally { cleanup() }
    }
    timer = setTimeout(cleanup, 5000); handles.set(token, { settle, cleanup }); return result
  } catch { cleanup(); return { failure: 'native-unavailable' } }
}

/** Settles or cancels the media state handle `token` names; false when there is none. */
export function mediaStateSettlementInPage(token: string, cancel: boolean): boolean {
  const handle = (globalThis as MediaStatePage).__hronautMediaState?.get(token)
  if (cancel) { handle?.cleanup(); return false }
  return handle ? handle.settle() : false
}
