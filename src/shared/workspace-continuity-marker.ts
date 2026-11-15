import { pageScript } from './page-script.js'
import { continuityMarkerInPage } from './workspace-continuity-marker.page.js'

/** Throws unless the marker selector has 1 to 256 UTF-8 bytes. */
export function validateContinuityMarkerSelector(selector: string): void {
  if (typeof selector !== 'string' || !selector.trim() || new TextEncoder().encode(selector).length > 256) {
    throw new TypeError('Continuity marker selector must contain 1 to 256 UTF-8 bytes')
  }
}

/** Opt-in marker extraction. Neither the selector nor page text belongs in a
 * continuity report or persisted checkpoint. The page result is untrusted. */
export function continuityMarkerScript(selector: string): string {
  validateContinuityMarkerSelector(selector)
  return pageScript(continuityMarkerInPage, selector)
}

export async function readContinuityMarker(evaluate: () => Promise<unknown>, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    const pending = [
      Promise.resolve().then(() => signal?.aborted ? null : evaluate()),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000) })
    ]
    if (signal) pending.push(new Promise<null>(resolve => {
      onAbort = () => resolve(null)
      signal.addEventListener('abort', onAbort, { once: true })
    }))
    const value = await Promise.race(pending)
    if (signal?.aborted) return null
    return typeof value === 'string' && new TextEncoder().encode(value).length <= 512 ? value : null
  } catch { return null } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}
