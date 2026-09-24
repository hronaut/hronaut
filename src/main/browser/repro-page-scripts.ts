export function reproTargetScript(point?: {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
}): string {
  return `(() => {
    const compact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const point = ${JSON.stringify(point)};
    const x = point ? Number(point.x) * innerWidth / Math.max(1, Number(point.viewportWidth)) : 0;
    const y = point ? Number(point.y) * innerHeight / Math.max(1, Number(point.viewportHeight)) : 0;
    let element = point ? document.elementFromPoint(x, y) : document.activeElement;
    // Document hit testing/focus retargets shadow descendants to their host.
    // Find the actual open-shadow target so it cannot receive the host's selector.
    const visited = new Set();
    while (element instanceof Element && element.shadowRoot && !visited.has(element)) {
      visited.add(element);
      const nested = point
        ? element.shadowRoot.elementFromPoint(x, y)
        : element.shadowRoot.activeElement;
      if (!(nested instanceof Element) || nested === element) break;
      element = nested;
    }
    if (!(element instanceof Element) || element === document.documentElement || element === document.body) return null;
    const selectorFor = (target) => {
      const parts = [];
      let node = target;
      while (node instanceof Element && node !== document.documentElement) {
        let part = node.localName || 'element';
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((candidate) => candidate.localName === node.localName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        const selector = parts.join(' > ');
        if (selector.length > 500) return '';
        try {
          const matches = document.querySelectorAll(selector);
          if (matches.length === 1 && matches[0] === target) return selector;
        } catch { return ''; }
        node = parent;
      }
      return '';
    };
    const input = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
    const associatedLabel = input && 'labels' in element && element.labels?.length
      ? [...element.labels].map((label) => label.innerText || label.textContent || '').join(' ')
      : '';
    const label = compact(
      element.getAttribute('aria-label')
        || associatedLabel
        || element.getAttribute('title')
        || element.getAttribute('alt')
        || element.getAttribute('placeholder')
        || (input ? '' : element.innerText || element.textContent || ''),
      180
    );
    return {
      selector: element.localName === 'iframe' || element.localName === 'frame' ? '' : selectorFor(element),
      tag: (element.localName || element.tagName.toLowerCase()).slice(0, 64),
      role: compact(element.getAttribute('role') || '', 64) || undefined,
      label: label || undefined,
      inputType: element instanceof HTMLInputElement ? compact(element.type || 'text', 40) : undefined
    };
  })()`
}

export function reproScrollScript(): string {
  return `(() => ({ x: Math.round(scrollX), y: Math.round(scrollY) }))()`
}
