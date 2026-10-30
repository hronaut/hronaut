/** One observation's visibility check, and the value it throws when its bounded walk runs out. */
export interface RenderedVisibility {
  visible: (node: Node, depth?: number) => boolean
  limit: object
}

/**
 * Runs in the page: bounded visibility shared by explicit observations. The check matches the visibility semantics of
 * the exported Playwright assertion. Boxless display:contents nodes can have rendered descendants, so it walks them,
 * bounded, and throws `limit` for an incomplete observation rather than reporting hidden.
 */
export function renderedVisibilityInPage(): RenderedVisibility {
  let visits = 0
  const limit = {}
  const visible = (node: Node, depth = 0): boolean => {
    if (++visits > 1000 || depth > 100) throw limit
    if (node.nodeType === Node.TEXT_NODE) {
      const range = document.createRange()
      range.selectNode(node)
      const rect = range.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    if (!(node instanceof Element)) return false
    const style = getComputedStyle(node)
    if (style.display === 'contents') {
      for (const child of node.childNodes) if (visible(child, depth + 1)) return true
      return false
    }
    if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return false
    if (style.visibility !== 'visible') return false
    const rect = node.getBoundingClientRect()
    return rect.width > 0 && rect.height > 0
  }
  return { visible, limit }
}
