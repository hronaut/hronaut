/** Bounded browser-side visibility shared by explicit observations. */
export function renderedVisibilityHelpersSource(): string {
  return `
    // Match the visibility semantics of the exported Playwright assertion.
    // Boxless display:contents nodes can have rendered descendants. Bound that
    // walk and reject incomplete observations rather than reporting hidden.
    let renderedVisibilityVisits = 0;
    const renderedVisibilityLimit = {};
    const renderedVisible = (node, depth = 0) => {
      if (++renderedVisibilityVisits > 1000 || depth > 100) throw renderedVisibilityLimit;
      if (node.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.selectNode(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      if (!(node instanceof Element)) return false;
      const style = getComputedStyle(node);
      if (style.display === 'contents') {
        for (const child of node.childNodes) if (renderedVisible(child, depth + 1)) return true;
        return false;
      }
      if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return false;
      if (style.visibility !== 'visible') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
  `
}
