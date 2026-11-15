/**
 * Runs in the continuity marker's isolated world: the text of the one element the selector matches, or null when it
 * matches none or several, the selector does not parse, or the text has more than 1024 nodes or 512 characters or bytes.
 */
export function continuityMarkerInPage(selector: string): string | null {
  try {
    const matches = document.querySelectorAll(selector)
    if (matches.length !== 1) return null
    const walker = document.createTreeWalker(matches[0]!, NodeFilter.SHOW_TEXT)
    let value = '', nodes = 0, node: Text | null
    while ((node = walker.nextNode() as Text | null)) {
      if (++nodes > 1024 || value.length + node.data.length > 512) return null
      value += node.data
    }
    return new TextEncoder().encode(value).length <= 512 ? value : null
  } catch { return null }
}
