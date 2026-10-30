import { pageScript } from '../../shared/page-script.js'
import type { BrowserImageState } from '../../shared/types.js'
import { imageStateInPage, imageStateSettlementInPage } from './image-state.page.js'
import { ISOLATED_WORLDS } from './isolated-worlds.js'

export const IMAGE_STATE_WORLD_ID = ISOLATED_WORLDS.imageState

export function imageStateScript(selector: string, token: string, deadline: number): string {
  return pageScript(imageStateInPage, selector, token, deadline)
}

export function imageStateSettlementScript(token: string, cancel = false): string {
  return pageScript(imageStateSettlementInPage, token, cancel)
}

export function normalizeImageState(raw: unknown): BrowserImageState {
  const invalid = () => { throw new Error('Image state unavailable: invalid native report') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
  const value = raw as Record<string, unknown>
  const failures: Record<string, string> = {
    expired: 'Image state inspection expired', busy: 'Image state unavailable: inspection busy',
    'document-limit': 'Image state requires at most 5000 light-DOM elements',
    'invalid-selector': 'Image state requires a valid selector',
    'missing-target': 'Image state target not found', 'ambiguous-target': 'Image state requires one unique current target',
    'unsupported-document': 'Image state requires an HTML document',
    'unsupported-target': 'Image state unsupported: select a top-level HTML image element',
    'native-unavailable': 'Image state unavailable: native scalar acquisition failed'
  }
  if (Object.keys(value).length === 1 && typeof value.failure === 'string' && Object.hasOwn(failures, value.failure)) throw new Error(failures[value.failure])
  const keys = ['observedAt', 'complete', 'naturalWidth', 'naturalHeight', 'hasSelectedSource']
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid()
  const integer = (name: string, max: number) => typeof value[name] === 'number' && Number.isSafeInteger(value[name]) && value[name] >= 0 && value[name] <= max
  if (!integer('observedAt', Number.MAX_SAFE_INTEGER) || !integer('naturalWidth', 4294967295) || !integer('naturalHeight', 4294967295)
    || typeof value.complete !== 'boolean' || typeof value.hasSelectedSource !== 'boolean' || JSON.stringify(value).length > 512) return invalid()
  return value as unknown as BrowserImageState
}

/** Main-owned admission includes native work still pending after caller timeout. */
export class ImageInspectionSlots {
  constructor(private readonly label = 'Image state') {}
  private readonly counts = new WeakMap<object, number>()
  acquire(owner: object): { track<T>(operation: Promise<T>): Promise<T>; close(cleanup?: Promise<unknown>): void } {
    const count = this.counts.get(owner) ?? 0
    if (count >= 8) throw new Error(`${this.label} unavailable: inspection busy`)
    this.counts.set(owner, count + 1)
    let pending = 0, closed = false, released = false
    const release = () => {
      if (!closed || pending || released) return
      released = true
      const remaining = (this.counts.get(owner) ?? 1) - 1
      if (remaining) this.counts.set(owner, remaining); else this.counts.delete(owner)
    }
    const track = <T>(operation: Promise<T>): Promise<T> => {
      pending++
      void operation.then(() => { pending--; release() }, () => { pending--; release() })
      return operation
    }
    return { track, close: cleanup => {
      if (closed) return
      if (cleanup) track(cleanup)
      closed = true; release()
    } }
  }
}
