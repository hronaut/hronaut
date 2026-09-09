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

export async function readContinuityMarker(evaluate: () => Promise<unknown>): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const value = await Promise.race([
      Promise.resolve().then(evaluate),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 2000) })
    ])
    return typeof value === 'string' && new TextEncoder().encode(value).length <= 512 ? value : null
  } catch { return null } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
