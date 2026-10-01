/** Browser-side text collection. Never clear or clone editors into the live page. */
export function snapshotTextHelpersSource(): string {
  return String.raw`
    const snapshotEditorSelector = '[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]';
    const snapshotEditingContext = element => Boolean(element && (element.isContentEditable || element.closest(snapshotEditorSelector)));
    const snapshotEditorCache = new WeakMap();
    let snapshotTextLimited = false;
    let snapshotTextVisits = 10000;
    const snapshotSafeText = (element, depth = 0, filtered = false) => {
      if (!element || snapshotEditingContext(element)) return '';
      if (--snapshotTextVisits < 0 || depth > 100) { snapshotTextLimited = true; return ''; }
      let hasEditor = snapshotEditorCache.get(element);
      if (hasEditor === undefined) {
        hasEditor = Boolean(element.querySelector(snapshotEditorSelector));
        snapshotEditorCache.set(element, hasEditor);
      }
      // Preserve Chromium's existing rendered-text behavior for ordinary subtrees.
      if (!hasEditor && !filtered) return element.innerText || '';
      const style = getComputedStyle(element);
      if (style.display === 'none') return '';
      const visibleText = style.visibility !== 'hidden' && style.visibility !== 'collapse';
      if (!hasEditor && visibleText && style.display !== 'contents') return element.innerText || '';
      const parts = [];
      let length = 0;
      for (const child of element.childNodes) {
        if (--snapshotTextVisits < 0) { snapshotTextLimited = true; break; }
        let text = '';
        if (child.nodeType === 3 && visibleText) text = child.textContent || '';
        else if (child.nodeType === 1) {
          const childStyle = getComputedStyle(child);
          if (childStyle.display === 'none') continue;
          text = snapshotEditingContext(child) ? ' ' : snapshotSafeText(child, depth + 1, true);
          if (child.localName === 'br' || /^(block|flow-root|flex|grid|list-item|table)/.test(childStyle.display)) text = ' ' + text + ' ';
        }
        const remaining = MAX_CHARS + 1 - length;
        parts.push(text.slice(0, remaining));
        length += Math.min(text.length, remaining);
        if (text.length > remaining) { snapshotTextLimited = true; break; }
      }
      return parts.join('');
    };
  `
}
