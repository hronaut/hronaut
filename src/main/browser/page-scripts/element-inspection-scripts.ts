import { passwordOccupancySource } from '../password-occupancy.js'
import { sizingInputsSource, sizingLookupSource } from '../element-sizing-inputs.js'
import { formValiditySource } from '../form-validity.js'
import { valueComparisonSource } from '../value-comparison.js'
import { elementScrollGeometrySource } from '../element-scroll-geometry.js'
import { snapshotTextHelpersSource } from '../snapshot-text.js'

function elementInspectionHelpersSource(): string {
  return `
    const MAX_CHARS = 500;
    ${snapshotTextHelpersSource({ excludeFormControls: true, textContentFallback: true })}
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
        ? labelledBy.split(/\\s+/).map((id) => snapshotSafeText(document.getElementById(id))).join(' ')
        : '';
      const labels = 'labels' in element && element.labels
        ? [...element.labels].map((label) => snapshotSafeText(label)).join(' ')
        : '';
      const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      return hronautCompact(
        element.getAttribute('aria-label')
          || referenced
          || labels
          || element.getAttribute('alt')
          || element.getAttribute('title')
          || element.getAttribute('placeholder')
          || (formControl ? '' : snapshotSafeText(element)),
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
      resetSnapshotText();
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const padding = hronautEdges(style, 'padding');
      const border = hronautEdges(style, 'border', 'Width');
      const formControl = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement;
      const text = hronautCompact(formControl
        ? (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '')
        : snapshotSafeText(element), 500);
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
          focused: element.matches(':focus'),
          focusWithin: element.matches(':focus-within'),
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
      resetSnapshotText();
      const selector = selectorFor(element);
      const attributes = safeAttributes(element);
      const text = compact(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? (element.getAttribute('aria-label') || element.getAttribute('placeholder') || '')
        : snapshotSafeText(element), 500);
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

export function elementInspectionScript(target: { ref?: string; selector?: string; includeFonts?: boolean; includeScroll?: boolean; includePasswordOccupancy?: boolean; includeValidity?: boolean; includeSizingInputs?: boolean }, occupancyToken?: string, expectedValue?: string): string {
  return `(() => {
    ${elementInspectionHelpersSource()}
    const target = ${JSON.stringify(target)};
    ${target.includeSizingInputs === true ? sizingLookupSource() : ''}
    const element = target.includeSizingInputs === true ? sizingLookup()[0] : target.ref
      ? document.querySelector('[data-hronaut-ref="' + CSS.escape(target.ref) + '"]')
      : target.selector ? document.querySelector(target.selector) : null;
    if (!(element instanceof Element)) throw new Error('Element not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.');
    return {
      ...hronautInspectElement(element),
      ...(target.includeSizingInputs === true ? { sizingInputs: ${target.includeSizingInputs === true ? sizingInputsSource(occupancyToken ?? '') : 'undefined'} } : {}),
      ...(target.includePasswordOccupancy === true ? { passwordOccupancy: ${passwordOccupancySource(occupancyToken ?? '')} } : {}),
      ...(target.includeValidity === true ? { formValidity: ${target.includeValidity === true ? formValiditySource(occupancyToken ?? '') : 'undefined'} } : {}),
      ${expectedValue !== undefined ? `valueComparison: ${valueComparisonSource(occupancyToken ?? '', expectedValue)},` : ''}
      ...(target.includeScroll === true ? { scrollGeometry: ${elementScrollGeometrySource()} } : {}),
      ...(target.includeFonts === true ? { renderedFontsEligible: element instanceof HTMLElement
        && element.children.length === 0 && !element.shadowRoot
        && !element.matches('input,textarea,select,option,optgroup,iframe,frame,object,embed')
        && !snapshotEditingContext(element) } : {})
    };
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
    // A depth-limited structural path may still be ambiguous. Reuse the
    // supplied target only after checking the exact selected element again.
    const requestedSelector = target.ref
      ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector;
    const selector = [hronautSelectorFor(element), requestedSelector].find(value => {
      if (typeof value !== 'string' || !value || value.length > 1000 || /[\\u0000-\\u001f\\u007f]/.test(value)) return false;
      try {
        const matches = document.querySelectorAll(value);
        return matches.length === 1 && matches[0] === element;
      } catch { return false; }
    });
    if (!selector) throw new Error('The selected element did not produce a unique bounded selector. Take a fresh snapshot or provide a more specific CSS selector.');
    // The inspected target and uniqueness checks use the light DOM, while
    // Playwright's semantic locators also traverse open shadow roots. Do not
    // claim semantic uniqueness across roots we have not inspected.
    if ([...document.querySelectorAll('*')].some(candidate => candidate.shadowRoot)) {
      return { selector, candidates: [] };
    }
    const candidates = [];
    const uniqueElements = (predicate) => [...document.querySelectorAll('*')].filter(predicate).length === 1;
    const role = hronautRole(element);
    const name = hronautAccessibleName(element);
    const playwrightRoles = new Set(['alert', 'button', 'checkbox', 'combobox', 'dialog', 'heading', 'img', 'link', 'listbox', 'menuitem', 'option', 'progressbar', 'radio', 'row', 'searchbox', 'slider', 'spinbutton', 'switch', 'tab', 'textbox', 'treeitem']);
    if (name && playwrightRoles.has(role) && uniqueElements((candidate) => hronautRole(candidate) === role && hronautAccessibleName(candidate) === name)) {
      candidates.push({ strategy: 'role', role, value: name });
    }
    const labels = 'labels' in element && element.labels
      ? [...element.labels].map((label) => hronautCompact(snapshotSafeText(label), 500)).filter(Boolean)
      : [];
    for (const label of labels) {
      if (uniqueElements((candidate) => 'labels' in candidate && candidate.labels && [...candidate.labels].some((item) => hronautCompact(snapshotSafeText(item), 500) === label))) {
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
    // Filtered names need not equal Playwright's actual accessible name.
    // Keep non-text strategies, or let the caller use the unique CSS fallback.
    const safeCandidates = snapshotTextExcluded || snapshotTextLimited
      ? candidates.filter(candidate => candidate.strategy !== 'role' && candidate.strategy !== 'label')
      : candidates;
    return { selector, candidates: safeCandidates };
  })()`
}
