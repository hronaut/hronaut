export function snapshotScript(maxChars: number): string {
  return `(() => {
    const MAX_CHARS = ${maxChars};
    const interactive = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]';
    const safeUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol + '//';
        url.username = '';
        url.password = '';
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
          if (/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|secret|session|token)/i.test(key)) {
            url.searchParams.set(key, '[REDACTED]');
          }
        }
        return url.href;
      } catch {
        return '';
      }
    };
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };
    let refIndex = 0;
    for (const element of document.querySelectorAll('[data-hronaut-ref]')) element.removeAttribute('data-hronaut-ref');
    const lines = [];
    const add = (line) => {
      if (lines.join('\\n').length < MAX_CHARS) lines.push(line);
    };
    add('URL: ' + safeUrl(location.href));
    add('TITLE: ' + document.title);
    const headings = [...document.querySelectorAll('h1,h2,h3')].filter(visible).slice(0, 80);
    for (const heading of headings) {
      const text = (heading.innerText || '').replace(/\\s+/g, ' ').trim();
      if (text) add(heading.tagName.toLowerCase() + ': ' + text.slice(0, 300));
    }
    const elements = [...document.querySelectorAll(interactive)].filter(visible).slice(0, 500);
    for (const element of elements) {
      const ref = 'e' + (++refIndex);
      element.setAttribute('data-hronaut-ref', ref);
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.innerText || '';
      const href = element instanceof HTMLAnchorElement ? ' href=' + JSON.stringify(safeUrl(element.href)) : '';
      const state = element.disabled ? ' disabled' : element.checked ? ' checked' : '';
      add('[' + ref + '] ' + role + ' ' + JSON.stringify(String(label).replace(/\\s+/g, ' ').trim().slice(0, 300)) + href + state);
    }
    const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
    if (bodyText) add('TEXT: ' + bodyText.slice(0, Math.max(0, MAX_CHARS - lines.join('\\n').length)));
    return lines.join('\\n').slice(0, MAX_CHARS);
  })()`
}

function elementInspectionHelpersSource(): string {
  return `
    const hronautCompact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const hronautUnique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const hronautSelectorFor = (element) => {
      if (element.id) {
        const selector = '#' + CSS.escape(element.id);
        if (hronautUnique(selector)) return selector;
      }
      for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const selector = '[' + attribute + '=' + JSON.stringify(value) + ']';
        if (hronautUnique(selector)) return selector;
      }
      const parts = [];
      let node = element;
      while (node instanceof Element && node !== document.documentElement && parts.length < 8) {
        let part = node.localName || 'element';
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((candidate) => candidate.localName === node.localName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        const selector = parts.join(' > ');
        if (hronautUnique(selector)) return selector;
        node = parent;
      }
      return parts.join(' > ');
    };
    const hronautSafeAttributes = (element) => {
      const names = ['id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby', 'aria-disabled', 'aria-checked', 'title', 'href', 'src', 'alt', 'placeholder', 'data-testid', 'data-test', 'data-cy'];
      return names.flatMap((name) => {
        let value = element.getAttribute(name);
        if (!value) return [];
        if (name === 'href' || name === 'src') {
          try {
            const url = new URL(value, location.href);
            if (url.protocol === 'http:' || url.protocol === 'https:') {
              url.username = '';
              url.password = '';
              url.search = '';
              url.hash = '';
              value = url.href;
            } else if (url.protocol !== 'data:') value = url.href;
            else return [];
          } catch { return []; }
        }
        return [{ name, value: hronautCompact(value, 300) }];
      });
    };
    const hronautNumber = (value) => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
    };
    const hronautEdges = (style, prefix, suffix = '') => ({
      top: hronautNumber(style[prefix + 'Top' + suffix]),
      right: hronautNumber(style[prefix + 'Right' + suffix]),
      bottom: hronautNumber(style[prefix + 'Bottom' + suffix]),
      left: hronautNumber(style[prefix + 'Left' + suffix])
    });
    const hronautRole = (element) => {
      const explicit = element.getAttribute('role');
      if (explicit) return explicit;
      const tag = element.localName;
      if (tag === 'button') return 'button';
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = String(element.type || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
        return 'textbox';
      }
      return tag || 'element';
    };
    const hronautAccessibleName = (element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      const referenced = labelledBy
        ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
        : '';
      const labels = 'labels' in element && element.labels
        ? [...element.labels].map((label) => label.innerText || label.textContent || '').join(' ')
        : '';
      const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      return hronautCompact(
        element.getAttribute('aria-label')
          || referenced
          || labels
          || element.getAttribute('alt')
          || element.getAttribute('title')
          || element.getAttribute('placeholder')
          || (formControl ? '' : (element.innerText || element.textContent || '')),
        500
      );
    };
    const hronautRgb = (value) => {
      const match = String(value).match(/^rgba?\\(\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)\\s*,\\s*(\\d+(?:\\.\\d+)?)(?:\\s*,\\s*(\\d+(?:\\.\\d+)?))?\\s*\\)$/i);
      if (!match) return null;
      return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: match[4] === undefined ? 1 : Number(match[4]) };
    };
    const hronautLuminance = (color) => {
      const channel = (value) => {
        const normalized = value / 255;
        return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
    };
    const hronautContrast = (foreground, background) => {
      const front = hronautRgb(foreground);
      const back = hronautRgb(background);
      if (!front || !back || front.a !== 1 || back.a !== 1) return undefined;
      const first = hronautLuminance(front);
      const second = hronautLuminance(back);
      return Math.round(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)) * 100) / 100;
    };
    const hronautInspectElement = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const padding = hronautEdges(style, 'padding');
      const border = hronautEdges(style, 'border', 'Width');
      const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      const text = hronautCompact(formControl
        ? (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '')
        : (element.innerText || element.textContent || ''), 500);
      const ariaChecked = element.getAttribute('aria-checked');
      const nativeChecked = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
        ? element.checked
        : undefined;
      const checked = nativeChecked !== undefined
        ? nativeChecked
        : ariaChecked === 'mixed' ? 'mixed' : ariaChecked === 'true' ? true : ariaChecked === 'false' ? false : undefined;
      const focusable = !element.matches(':disabled') && (
        element.matches('a[href],button,input,select,textarea,summary,[contenteditable="true"]')
        || element.tabIndex >= 0
      );
      const isFlex = style.display.includes('flex');
      const isGrid = style.display.includes('grid');
      return {
        selector: hronautSelectorFor(element),
        tag: element.localName || element.tagName.toLowerCase(),
        text,
        attributes: hronautSafeAttributes(element),
        box: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          contentWidth: Math.max(0, rect.width - padding.left - padding.right - border.left - border.right),
          contentHeight: Math.max(0, rect.height - padding.top - padding.bottom - border.top - border.bottom),
          boxSizing: style.boxSizing,
          margin: hronautEdges(style, 'margin'),
          border,
          padding
        },
        layout: {
          display: style.display,
          position: style.position,
          zIndex: style.zIndex,
          visibility: style.visibility,
          opacity: style.opacity,
          overflowX: style.overflowX,
          overflowY: style.overflowY,
          ...(isFlex ? { flexDirection: style.flexDirection, alignItems: style.alignItems, justifyContent: style.justifyContent } : {}),
          ...(isGrid ? { gridTemplateColumns: style.gridTemplateColumns, gridTemplateRows: style.gridTemplateRows, alignItems: style.alignItems, justifyContent: style.justifyContent } : {})
        },
        typography: {
          color: style.color,
          backgroundColor: style.backgroundColor,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textAlign: style.textAlign,
          whiteSpace: style.whiteSpace,
          contrastRatio: hronautContrast(style.color, style.backgroundColor)
        },
        accessibility: {
          role: hronautRole(element),
          name: hronautAccessibleName(element),
          focusable,
          disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
          ...(checked !== undefined ? { checked } : {})
        }
      };
    };
  `
}

export function elementPickerScript(): string {
  return `(() => new Promise((resolve) => {
    const pickerKey = '__hronautElementPicker';
    const areaPicker = window.__hronautScreenshotArea;
    if (areaPicker && typeof areaPicker.cancel === 'function') areaPicker.cancel();
    const previous = window[pickerKey];
    if (previous && typeof previous.cancel === 'function') previous.cancel();

    const makeLayer = (name, background) => {
      const layer = document.createElement('div');
      layer.setAttribute('data-hronaut-element-picker', name);
      Object.assign(layer.style, {
        position: 'fixed',
        zIndex: '2147483646',
        pointerEvents: 'none',
        background,
        display: 'none'
      });
      return layer;
    };
    const marginLayer = makeLayer('margin', 'rgba(246, 178, 107, 0.34)');
    const overlay = makeLayer('overlay', 'rgba(255, 229, 153, 0.42)');
    const paddingLayer = makeLayer('padding', 'rgba(147, 196, 125, 0.42)');
    const contentLayer = makeLayer('content', 'rgba(111, 168, 220, 0.42)');
    Object.assign(overlay.style, {
      position: 'fixed',
      outline: '2px solid #6757e8',
      outlineOffset: '-1px',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.86)'
    });
    const label = document.createElement('div');
    label.setAttribute('data-hronaut-element-picker', 'label');
    Object.assign(label.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      maxWidth: 'min(520px, calc(100vw - 16px))',
      padding: '5px 8px',
      borderRadius: '5px',
      color: '#fff',
      background: '#5747d6',
      boxShadow: '0 3px 12px rgba(0, 0, 0, 0.28)',
      font: '600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      whiteSpace: 'pre-line',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      display: 'none'
    });
    document.documentElement.append(marginLayer, overlay, paddingLayer, contentLayer, label);

    ${elementInspectionHelpersSource()}

    let current = null;
    let nativeDown = null;
    let finished = false;
    const compact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const escapeHtml = (value) => String(value).replace(/[&<>\"]/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
    })[character]);
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
    };
    const selectorFor = (element) => {
      if (element.id) {
        const selector = '#' + CSS.escape(element.id);
        if (unique(selector)) return selector;
      }
      for (const attribute of ['data-testid', 'data-test', 'data-cy']) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const selector = '[' + attribute + '=' + JSON.stringify(value) + ']';
        if (unique(selector)) return selector;
      }
      const parts = [];
      let node = element;
      while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 7) {
        let part = node.localName;
        if (!part) break;
        if (node.id) {
          part = '#' + CSS.escape(node.id);
          parts.unshift(part);
          break;
        }
        const stableClasses = [...node.classList]
          .filter((name) => name.length <= 64 && !/^(active|focus|hover|selected|open|closed|disabled)$/i.test(name))
          .slice(0, 3);
        if (stableClasses.length) part += stableClasses.map((name) => '.' + CSS.escape(name)).join('');
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((candidate) => candidate.localName === node.localName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        const selector = parts.join(' > ');
        if (unique(selector)) return selector;
        node = parent;
      }
      return parts.join(' > ');
    };
    const safeUrl = () => {
      try {
        const url = new URL(location.href);
        url.username = '';
        url.password = '';
        url.hash = '';
        return url.href;
      } catch { return location.href.split('#')[0]; }
    };
    const safeAttributes = (element) => {
      const names = ['id', 'class', 'name', 'type', 'role', 'aria-label', 'aria-labelledby', 'title', 'href', 'src', 'alt', 'placeholder', 'data-testid', 'data-test', 'data-cy'];
      return names.flatMap((name) => {
        let value = element.getAttribute(name);
        if (!value) return [];
        if ((name === 'href' || name === 'src') && /^(https?:)?\\/\\//.test(value)) {
          try {
            const url = new URL(value, location.href);
            url.username = '';
            url.password = '';
            url.search = '';
            url.hash = '';
            value = url.href;
          } catch { return []; }
        }
        return [name + '=\"' + escapeHtml(compact(value, 240)) + '\"'];
      });
    };
    const describe = (element) => {
      const selector = selectorFor(element);
      const attributes = safeAttributes(element);
      const text = compact(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '')
        : (element.innerText || element.textContent || ''), 500);
      const rect = element.getBoundingClientRect();
      const tag = element.localName || element.tagName.toLowerCase();
      const voidElement = ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag);
      const elementSummary = '<' + tag + (attributes.length ? ' ' + attributes.join(' ') : '') + '>'
        + (voidElement ? '' : (text ? escapeHtml(text) : '') + '</' + tag + '>');
      return [
        'Selected DOM element',
        'Page: ' + compact(document.title, 200) + ' (' + safeUrl() + ')',
        'Selector: ' + selector,
        'Element: ' + elementSummary,
        text ? 'Text: ' + JSON.stringify(text) : '',
        'Bounds: x=' + Math.round(rect.x) + ', y=' + Math.round(rect.y) + ', width=' + Math.round(rect.width) + ', height=' + Math.round(rect.height)
      ].filter(Boolean).join('\\n');
    };
    const positionLayer = (layer, x, y, width, height) => {
      layer.style.display = width > 0 && height > 0 ? 'block' : 'none';
      layer.style.left = x + 'px';
      layer.style.top = y + 'px';
      layer.style.width = Math.max(0, width) + 'px';
      layer.style.height = Math.max(0, height) + 'px';
    };
    const edgeSummary = (edges) => [edges.top, edges.right, edges.bottom, edges.left].join('/');
    const position = (element) => {
      const inspection = hronautInspectElement(element);
      const rect = inspection.box;
      const margin = rect.margin;
      const border = rect.border;
      const padding = rect.padding;
      positionLayer(marginLayer, rect.x - margin.left, rect.y - margin.top, rect.width + margin.left + margin.right, rect.height + margin.top + margin.bottom);
      positionLayer(overlay, rect.x, rect.y, rect.width, rect.height);
      positionLayer(paddingLayer, rect.x + border.left, rect.y + border.top, rect.width - border.left - border.right, rect.height - border.top - border.bottom);
      positionLayer(contentLayer, rect.x + border.left + padding.left, rect.y + border.top + padding.top, rect.contentWidth, rect.contentHeight);
      label.style.display = 'block';
      const contrast = inspection.typography.contrastRatio === undefined ? '' : ' · contrast ' + inspection.typography.contrastRatio + ':1';
      const layout = inspection.layout.display.includes('flex') ? ' · flex' : inspection.layout.display.includes('grid') ? ' · grid' : '';
      const accessibleName = inspection.accessibility.name ? ' ' + JSON.stringify(inspection.accessibility.name) : '';
      label.textContent = [
        inspection.selector + ' · ' + Math.round(rect.width) + ' × ' + Math.round(rect.height) + ' px' + layout,
        'content ' + rect.contentWidth + ' × ' + rect.contentHeight + ' · padding ' + edgeSummary(padding) + ' · margin ' + edgeSummary(margin),
        inspection.accessibility.role + accessibleName + ' · ' + (inspection.accessibility.focusable ? 'keyboard focusable' : 'not keyboard focusable') + contrast,
        'Click to copy · Esc to cancel'
      ].join('\\n');
      const labelTop = rect.y >= 92 ? rect.y - 88 : Math.min(innerHeight - 84, rect.y + rect.height + 5);
      label.style.left = Math.max(8, Math.min(innerWidth - 520, rect.x)) + 'px';
      label.style.top = Math.max(4, labelTop) + 'px';
    };
    const cleanup = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange, true);
      marginLayer.remove();
      overlay.remove();
      paddingLayer.remove();
      contentLayer.remove();
      label.remove();
      if (window[pickerKey]?.cancel === cancel) delete window[pickerKey];
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(result);
    };
    const cancel = () => finish({ canceled: true });
    const onPointerMove = (event) => {
      if (window.__hronautAgentInputActive === true) return;
      const candidate = event.composedPath().find((node) => node instanceof Element && !node.hasAttribute?.('data-hronaut-element-picker'));
      if (!(candidate instanceof Element)) return;
      current = candidate;
      position(candidate);
    };
    const onClick = (event) => {
      if (window.__hronautAgentInputActive === true || event.isTrusted === false) return;
      const candidate = event.composedPath().find((node) => node instanceof Element && !node.hasAttribute?.('data-hronaut-element-picker'));
      if (!(candidate instanceof Element)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      finish({ canceled: false, inspection: hronautInspectElement(candidate) });
    };
    const nativeInput = (type, x, y) => {
      if (finished || !Number.isFinite(x) || !Number.isFinite(y)) return false;
      const candidate = document.elementFromPoint(
        Math.max(0, Math.min(innerWidth - 1, x)),
        Math.max(0, Math.min(innerHeight - 1, y))
      );
      if (!(candidate instanceof Element) || candidate.hasAttribute('data-hronaut-element-picker')) return false;
      current = candidate;
      position(candidate);
      if (type === 'down') {
        nativeDown = candidate;
        return true;
      }
      if (type !== 'up') return true;
      const pressed = nativeDown;
      nativeDown = null;
      if (!(pressed instanceof Element)) return false;
      if (pressed !== candidate && !pressed.contains(candidate) && !candidate.contains(pressed)) return false;
      finish({ canceled: false, inspection: hronautInspectElement(candidate) });
      return true;
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      cancel();
    };
    const onViewportChange = () => { if (current?.isConnected) position(current); };
    window[pickerKey] = { cancel, nativeInput };
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange, true);
  }))()`
}

export function cancelElementPickerScript(): string {
  return `(() => {
    const picker = window.__hronautElementPicker;
    if (!picker || typeof picker.cancel !== 'function') return false;
    picker.cancel();
    return true;
  })()`
}

export function elementPickerNativeInputScript(
  type: 'down' | 'move' | 'up',
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return `(() => {
    const picker = window.__hronautElementPicker;
    if (!picker || typeof picker.nativeInput !== 'function') return false;
    const width = Math.max(1, ${JSON.stringify(viewportWidth)});
    const height = Math.max(1, ${JSON.stringify(viewportHeight)});
    return picker.nativeInput(
      ${JSON.stringify(type)},
      ${JSON.stringify(x)} * innerWidth / width,
      ${JSON.stringify(y)} * innerHeight / height
    );
  })()`
}

export function elementPickerInspectionAtPointScript(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return `(() => {
    ${elementInspectionHelpersSource()}
    const width = Math.max(1, ${JSON.stringify(viewportWidth)});
    const height = Math.max(1, ${JSON.stringify(viewportHeight)});
    const candidate = document.elementFromPoint(
      Math.max(0, Math.min(innerWidth - 1, ${JSON.stringify(x)} * innerWidth / width)),
      Math.max(0, Math.min(innerHeight - 1, ${JSON.stringify(y)} * innerHeight / height))
    );
    if (!(candidate instanceof Element) || candidate.hasAttribute('data-hronaut-element-picker')) {
      throw new Error('No selectable element was found at the pointer position.');
    }
    return hronautInspectElement(candidate);
  })()`
}

export function elementInspectionScript(target: { ref?: string; selector?: string }): string {
  return `(() => {
    ${elementInspectionHelpersSource()}
    const target = ${JSON.stringify(target)};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!(element instanceof Element)) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    return hronautInspectElement(element);
  })()`
}

export function playwrightLocatorScript(target: { ref?: string; selector?: string }): string {
  return `(() => {
    ${elementInspectionHelpersSource()}
    const target = ${JSON.stringify(target)};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!(element instanceof Element)) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    const candidates = [];
    const uniqueElements = (predicate) => [...document.querySelectorAll('*')].filter(predicate).length === 1;
    const role = hronautRole(element);
    const name = hronautAccessibleName(element);
    const playwrightRoles = new Set(['alert', 'button', 'checkbox', 'combobox', 'dialog', 'heading', 'img', 'link', 'listbox', 'menuitem', 'option', 'progressbar', 'radio', 'row', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem']);
    if (name && playwrightRoles.has(role) && uniqueElements((candidate) => hronautRole(candidate) === role && hronautAccessibleName(candidate) === name)) {
      candidates.push({ strategy: 'role', role, value: name });
    }
    const labels = 'labels' in element && element.labels
      ? [...element.labels].map((label) => hronautCompact(label.innerText || label.textContent || '', 500)).filter(Boolean)
      : [];
    for (const label of labels) {
      if (uniqueElements((candidate) => 'labels' in candidate && candidate.labels && [...candidate.labels].some((item) => hronautCompact(item.innerText || item.textContent || '', 500) === label))) {
        candidates.push({ strategy: 'label', value: label });
        break;
      }
    }
    const testId = element.getAttribute('data-testid');
    const boundedTestId = hronautCompact(testId, 500);
    if (testId && testId === boundedTestId && uniqueElements((candidate) => candidate.getAttribute('data-testid') === testId)) {
      candidates.push({ strategy: 'test-id', value: testId });
    }
    const attributes = [
      ['placeholder', 'placeholder'],
      ['alt', 'alt-text'],
      ['title', 'title']
    ];
    for (const [attribute, strategy] of attributes) {
      const value = element.getAttribute(attribute);
      const boundedValue = hronautCompact(value, 500);
      if (value && value === boundedValue && uniqueElements((candidate) => candidate.getAttribute(attribute) === value)) {
        candidates.push({ strategy, value });
      }
    }
    return { selector: hronautSelectorFor(element), candidates };
  })()`
}

export function screenshotAreaScript(): string {
  return `(() => new Promise((resolve) => {
    const pickerKey = '__hronautScreenshotArea';
    const elementPicker = window.__hronautElementPicker;
    if (elementPicker && typeof elementPicker.cancel === 'function') elementPicker.cancel();
    const previous = window[pickerKey];
    if (previous && typeof previous.cancel === 'function') previous.cancel();

    const shade = document.createElement('div');
    shade.setAttribute('data-hronaut-screenshot-area', 'shade');
    Object.assign(shade.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483646',
      pointerEvents: 'auto',
      background: 'rgba(8, 7, 20, 0.32)',
      cursor: 'crosshair'
    });
    const selection = document.createElement('div');
    selection.setAttribute('data-hronaut-screenshot-area', 'selection');
    Object.assign(selection.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
      border: '2px solid #8c7cff',
      borderRadius: '3px',
      background: 'rgba(103, 87, 232, 0.08)',
      boxShadow: '0 0 0 1px rgba(255, 255, 255, 0.92), 0 5px 22px rgba(0, 0, 0, 0.28)'
    });
    const hint = document.createElement('div');
    hint.setAttribute('data-hronaut-screenshot-area', 'hint');
    hint.textContent = 'Drag to capture an area  ·  Esc to cancel';
    Object.assign(hint.style, {
      position: 'fixed',
      zIndex: '2147483647',
      top: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      pointerEvents: 'none',
      padding: '7px 11px',
      borderRadius: '7px',
      color: '#fff',
      background: '#5747d6',
      boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
      font: '650 12px/1.35 system-ui, sans-serif',
      whiteSpace: 'nowrap'
    });
    const size = document.createElement('div');
    size.setAttribute('data-hronaut-screenshot-area', 'size');
    Object.assign(size.style, {
      position: 'fixed',
      zIndex: '2147483647',
      pointerEvents: 'none',
      display: 'none',
      padding: '4px 7px',
      borderRadius: '5px',
      color: '#fff',
      background: '#17142d',
      font: '600 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      whiteSpace: 'nowrap'
    });
    document.documentElement.append(shade, selection, hint, size);

    const previousCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = 'crosshair';
    let start = null;
    let current = null;
    let finished = false;
    const point = (event) => ({
      x: Math.max(0, Math.min(innerWidth, event.clientX)),
      y: Math.max(0, Math.min(innerHeight, event.clientY))
    });
    const rectangle = () => {
      if (!start || !current) return null;
      const left = Math.floor(Math.min(start.x, current.x));
      const top = Math.floor(Math.min(start.y, current.y));
      const right = Math.ceil(Math.max(start.x, current.x));
      const bottom = Math.ceil(Math.max(start.y, current.y));
      return { x: left, y: top, width: right - left, height: bottom - top };
    };
    const selectionResult = () => {
      const clip = rectangle();
      if (!clip) return null;
      return {
        canceled: false,
        clip,
        pageClip: { x: scrollX + clip.x, y: scrollY + clip.y, width: clip.width, height: clip.height },
        viewport: { width: innerWidth, height: innerHeight },
        url: location.href
      };
    };
    const draw = () => {
      const rect = rectangle();
      if (!rect) return;
      shade.style.background = 'transparent';
      shade.style.boxShadow = 'none';
      selection.style.display = 'block';
      selection.style.left = rect.x + 'px';
      selection.style.top = rect.y + 'px';
      selection.style.width = rect.width + 'px';
      selection.style.height = rect.height + 'px';
      selection.style.boxShadow = '0 0 0 99999px rgba(8, 7, 20, 0.32), 0 0 0 1px rgba(255, 255, 255, 0.92), 0 5px 22px rgba(0, 0, 0, 0.28)';
      size.style.display = 'block';
      size.textContent = rect.width + ' × ' + rect.height;
      size.style.left = Math.max(6, Math.min(innerWidth - 92, rect.x)) + 'px';
      size.style.top = Math.max(6, rect.y >= 29 ? rect.y - 27 : Math.min(innerHeight - 25, rect.y + rect.height + 5)) + 'px';
    };
    const cleanup = () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.removeEventListener('pointercancel', onPointerCancel, true);
      shade.removeEventListener('lostpointercapture', onLostPointerCapture);
      document.removeEventListener('keydown', onKeyDown, true);
      document.documentElement.style.cursor = previousCursor;
      shade.remove();
      selection.remove();
      hint.remove();
      size.remove();
      if (window[pickerKey]?.cancel === cancel) delete window[pickerKey];
    };
    const finish = (result) => {
      if (finished) return;
      finished = true;
      cleanup();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(result)));
    };
    const cancel = () => finish({ canceled: true });
    const consume = (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const beginAt = (candidate) => {
      start = candidate;
      current = start;
      draw();
    };
    const moveTo = (candidate) => {
      if (!start) return;
      current = candidate;
      draw();
    };
    const completeAt = (candidate) => {
      if (!start) return false;
      current = candidate;
      const result = selectionResult();
      if (!result || result.clip.width < 2 || result.clip.height < 2) {
        start = null;
        current = null;
        selection.style.display = 'none';
        size.style.display = 'none';
        shade.style.background = 'rgba(8, 7, 20, 0.32)';
        shade.style.boxShadow = 'none';
        hint.textContent = 'Drag a larger area  ·  Esc to cancel';
        return false;
      }
      finish(result);
      return true;
    };
    const nativeInput = (type, x, y) => {
      if (finished) return false;
      const candidate = {
        x: Math.max(0, Math.min(innerWidth, Number(x))),
        y: Math.max(0, Math.min(innerHeight, Number(y)))
      };
      if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return false;
      if (type === 'down') beginAt(candidate);
      else if (type === 'move') moveTo(candidate);
      else if (type === 'up') return completeAt(candidate);
      return true;
    };
    const onPointerDown = (event) => {
      if (event.button !== 0 || window.__hronautAgentInputActive === true) return;
      consume(event);
      beginAt(point(event));
      try { shade.setPointerCapture(event.pointerId); } catch {}
    };
    const onPointerMove = (event) => {
      if (!start || window.__hronautAgentInputActive === true) return;
      consume(event);
      if (event.pointerType === 'mouse' && event.buttons === 0) completeAt(point(event));
      else moveTo(point(event));
    };
    const onPointerUp = (event) => {
      if (!start || event.button !== 0 || window.__hronautAgentInputActive === true) return;
      consume(event);
      completeAt(point(event));
    };
    const onLostPointerCapture = () => {
      if (finished || !start || !current) return;
      const result = selectionResult();
      if (result && result.clip.width >= 2 && result.clip.height >= 2) finish(result);
    };
    const onPointerCancel = (event) => {
      if (!start) return;
      consume(event);
      cancel();
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      consume(event);
      cancel();
    };
    window[pickerKey] = { cancel, nativeInput };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    shade.addEventListener('lostpointercapture', onLostPointerCapture);
    document.addEventListener('keydown', onKeyDown, true);
  }))()`
}

export function screenshotAreaNativeInputScript(
  type: 'down' | 'move' | 'up',
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return `(() => {
    const picker = window.__hronautScreenshotArea;
    if (!picker || typeof picker.nativeInput !== 'function') return false;
    const width = Math.max(1, ${JSON.stringify(viewportWidth)});
    const height = Math.max(1, ${JSON.stringify(viewportHeight)});
    return picker.nativeInput(
      ${JSON.stringify(type)},
      ${JSON.stringify(x)} * innerWidth / width,
      ${JSON.stringify(y)} * innerHeight / height
    );
  })()`
}

export function cancelScreenshotAreaScript(): string {
  return `(() => {
    const picker = window.__hronautScreenshotArea;
    if (!picker || typeof picker.cancel !== 'function') return false;
    picker.cancel();
    return true;
  })()`
}

export function targetActionScript(
  action: 'click' | 'type' | 'select',
  target: { ref?: string; selector?: string },
  text?: string,
  submit?: boolean
): string {
  const encodedTarget = JSON.stringify(target)
  const encodedText = JSON.stringify(text ?? '')
  return `(() => {
    const target = ${encodedTarget};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    element.focus();
    if (${JSON.stringify(action)} === 'click') {
      element.click();
      return { ok: true, tag: element.tagName.toLowerCase() };
    }
    const value = ${encodedText};
    if (${JSON.stringify(action)} === 'select') {
      if (!(element instanceof HTMLSelectElement)) throw new Error('Target is not a select element.');
      const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value);
      if (!option) throw new Error('Select option not found: ' + value);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
      setter?.call(element, option.value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, tag: 'select', value: option.value, label: option.label || option.text };
    }
    if (element instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(element, value);
    } else if (element instanceof HTMLTextAreaElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(element, value);
    } else if (element.isContentEditable) {
      element.textContent = value;
    } else {
      throw new Error('Target is not an editable element.');
    }
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (${Boolean(submit)}) {
      const form = element.closest('form');
      if (form && typeof form.requestSubmit === 'function') form.requestSubmit();
      else element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    }
    return { ok: true, tag: element.tagName.toLowerCase(), value };
  })()`
}

function dialogOverridesScript(action: 'accept' | 'dismiss', promptText?: string): string {
  return `
    const originalDialogs = Object.fromEntries(
      ['alert', 'confirm', 'prompt'].map((name) => [name, Object.getOwnPropertyDescriptor(window, name)])
    );
    const accept = ${action === 'accept'};
    const hasPromptText = ${promptText !== undefined};
    const promptResponse = ${JSON.stringify(promptText ?? '')};
    Object.defineProperties(window, {
      alert: {
        configurable: true,
        writable: true,
        value: function () { return undefined; }
      },
      confirm: {
        configurable: true,
        writable: true,
        value: function () { return accept; }
      },
      prompt: {
        configurable: true,
        writable: true,
        value: function (_message, defaultValue) {
          if (!accept) return null;
          if (hasPromptText) return promptResponse;
          return arguments.length > 1 ? String(defaultValue) : '';
        }
      }
    });
    const restoreDialogs = function () {
      for (const name of ['alert', 'confirm', 'prompt']) {
        const descriptor = originalDialogs[name];
        if (descriptor) Object.defineProperty(window, name, descriptor);
        else delete window[name];
      }
    };`
}

export function dialogAwareClickScript(
  target: { ref?: string; selector?: string },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return `(() => {
    const target = ${JSON.stringify(target)};
    const element = target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    element.focus();
    ${dialogOverridesScript(action, promptText)}
    try {
      element.click();
      return { ok: true, tag: element.tagName.toLowerCase() };
    } finally {
      restoreDialogs();
    }
  })()`
}

export function dialogAwareCoordinateClickScript(
  point: { x: number; y: number },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return `(() => {
    const point = ${JSON.stringify(point)};
    const element = document.elementFromPoint(point.x, point.y);
    if (!(element instanceof Element)) throw new Error('No element exists at the requested viewport coordinates.');
    if (element instanceof HTMLElement) element.focus();
    ${dialogOverridesScript(action, promptText)}
    try {
      element.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        clientX: point.x,
        clientY: point.y,
        button: 0,
        buttons: 0
      }));
      return { ok: true, tag: element.tagName.toLowerCase(), x: point.x, y: point.y };
    } finally {
      restoreDialogs();
    }
  })()`
}

export function targetExpression(target: { ref?: string; selector?: string }): string {
  const encodedTarget = JSON.stringify(target)
  return `(() => {
    const target = ${encodedTarget};
    return target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
  })()`
}

export interface BrowserFormField {
  ref?: string
  selector?: string
  value: string | boolean
}

export function fillFormScript(fields: BrowserFormField[]): string {
  return `(() => {
    const fields = ${JSON.stringify(fields)};
    const resolve = (target) => target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    return fields.map((field, index) => {
      const element = resolve(field);
      if (!element) throw new Error('Form field ' + (index + 1) + ' was not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
      element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      element.focus();
      if (element instanceof HTMLSelectElement) {
        const value = String(field.value);
        const option = [...element.options].find((candidate) => candidate.value === value || candidate.label === value || candidate.text === value);
        if (!option) throw new Error('Select option not found for form field ' + (index + 1) + ': ' + value);
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(element, option.value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return { index, tag: 'select', value: option.value, label: option.label || option.text };
      }
      if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
        const checked = typeof field.value === 'boolean' ? field.value : field.value === 'true';
        if (element.checked !== checked) element.click();
        return { index, tag: 'input', type: element.type, checked: element.checked };
      }
      const value = String(field.value);
      if (element instanceof HTMLInputElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(element, value);
      } else if (element instanceof HTMLTextAreaElement) {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
        setter?.call(element, value);
      } else if (element.isContentEditable) {
        element.textContent = value;
      } else {
        throw new Error('Form field ' + (index + 1) + ' is not editable.');
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return { index, tag: element.tagName.toLowerCase(), value };
    });
  })()`
}

export function targetPointScript(target: { ref?: string; selector?: string }): string {
  return `(() => {
    const element = ${targetExpression(target)};
    if (!element) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Element has no visible bounds.');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName.toLowerCase() };
  })()`
}

export function reproTargetScript(point?: {
  x: number
  y: number
  viewportWidth: number
  viewportHeight: number
}): string {
  return `(() => {
    const compact = (value, limit) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, limit);
    const point = ${JSON.stringify(point)};
    const element = point
      ? document.elementFromPoint(
          Number(point.x) * innerWidth / Math.max(1, Number(point.viewportWidth)),
          Number(point.y) * innerHeight / Math.max(1, Number(point.viewportHeight))
        )
      : document.activeElement;
    if (!(element instanceof Element) || element === document.documentElement || element === document.body) return null;
    const selectorFor = (target) => {
      const parts = [];
      let node = target;
      while (node instanceof Element && node !== document.documentElement && parts.length < 7) {
        let part = node.localName || 'element';
        const parent = node.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((candidate) => candidate.localName === node.localName);
          if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(' > ').slice(0, 500);
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
      selector: selectorFor(element),
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
