/** Browser-side text collection. Never clear or clone editors into the live page. */
export function snapshotTextHelpersSource(options: { excludeFormControls?: boolean; textContentFallback?: boolean } = {}): string {
  const excluded = '[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]' + (options.excludeFormControls ? ',input,textarea,select' : '')
  return String.raw`
    const snapshotEditorSelector = ${JSON.stringify(excluded)};
    const snapshotEditingContext = element => Boolean(element && (element.isContentEditable || element.closest(snapshotEditorSelector)));
    let snapshotEditorCache = new WeakMap();
    let snapshotTextExcluded = false;
    let snapshotTextLimited = false;
    let snapshotTextVisits = 10000;
    const resetSnapshotText = () => {
      snapshotEditorCache = new WeakMap();
      snapshotTextExcluded = false;
      snapshotTextLimited = false;
      snapshotTextVisits = 10000;
    };
    const snapshotSafeText = (element, depth = 0, filtered = false) => {
      if (!element) return '';
      if (snapshotEditingContext(element)) { snapshotTextExcluded = true; return ''; }
      if (--snapshotTextVisits < 0 || depth > 100) { snapshotTextLimited = true; return ''; }
      let hasEditor = snapshotEditorCache.get(element);
      if (hasEditor === undefined) {
        hasEditor = Boolean(element.querySelector(snapshotEditorSelector));
        snapshotEditorCache.set(element, hasEditor);
      }
      if (hasEditor) snapshotTextExcluded = true;
      // Preserve Chromium's existing rendered-text behavior for ordinary subtrees.
      if (!hasEditor && !filtered) return element.innerText || ${options.textContentFallback ? "element.textContent || ''" : "''"};
      const style = getComputedStyle(element);
      if (style.display === 'none') return '';
      const visibleText = style.visibility !== 'hidden' && style.visibility !== 'collapse';
      if (!hasEditor && visibleText && style.display !== 'contents') return element.innerText || ${options.textContentFallback ? "element.textContent || ''" : "''"};
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
