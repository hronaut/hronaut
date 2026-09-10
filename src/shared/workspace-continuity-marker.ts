/** Opt-in marker extraction. Neither the selector nor page text belongs in a
 * continuity report or persisted checkpoint. The page result is untrusted. */
export function continuityMarkerScript(selector: string): string {
  if (typeof selector !== 'string' || !selector.trim() || new TextEncoder().encode(selector).length > 256) {
    throw new TypeError('Continuity marker selector must contain 1 to 256 UTF-8 bytes')
  }
  return `(() => {
    try {
      const matches = document.querySelectorAll(${JSON.stringify(selector)});
      if (matches.length !== 1) return null;
      const walker = document.createTreeWalker(matches[0], NodeFilter.SHOW_TEXT);
      let value = '', nodes = 0, node;
      while ((node = walker.nextNode())) {
        if (++nodes > 1024 || value.length + node.data.length > 512) return null;
        value += node.data;
      }
      return new TextEncoder().encode(value).length <= 512 ? value : null;
    } catch { return null; }
  })()`
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
