import { URL_DETAIL_OMITTED_NOTE, urlWithoutDetail } from '../../../shared/url-detail.js'

/**
 * The page script of a shadow snapshot. It runs in the shadow snapshot's own
 * isolated world, which shares the page's DOM but not its scripts, so the page
 * cannot replace the DOM methods it calls. It only reads: it keeps no state,
 * writes no attributes, and neither scrolls nor moves focus.
 */

/** Hard bounds of one shadow snapshot's walk and lists. */
export const SHADOW_SNAPSHOT_LIMITS = { nodes: 10_000, depth: 100, durationMs: 500, headings: 80, controls: 500 } as const

/** Content a shadow snapshot left out, by policy or because a bound stopped it. */
export type ShadowSnapshotOmission =
  | 'frames'
  | 'private-editors'
  | 'node-limit'
  | 'depth-limit'
  | 'duration-limit'
  | 'heading-limit'
  | 'control-limit'
  | 'text-limit'

/** Why the host cannot be captured: each maps to one message in shadow-snapshot.ts. */
export type ShadowSnapshotProblem = 'invalid-selector' | 'missing-host' | 'ambiguous-host' | 'no-open-shadow-root' | 'editable-host' | 'hidden-host'

/** What the page script returns: the capture's text and what it left out, or why there is none. */
export type ShadowSnapshotPage =
  | { problem: ShadowSnapshotProblem }
  | { hostTag: string; text: string; omissions: ShadowSnapshotOmission[]; shadowRoots: number; assignedSlots: number }

/**
 * Reads the open shadow root of the one top-level element the selector
 * matches, in the order the page renders it: nested open shadow roots in
 * place of their hosts' children, and each slot's assigned nodes once, or its
 * fallback content when nothing is assigned. It lists the visible headings and
 * controls a snapshot lists, without refs, and the rendered text. Form field
 * values and editor content are never read, and frames, closed shadow roots
 * and built-in ones such as a video's controls are not entered. Content that
 * is not rendered is left out: a light child no slot takes, hidden elements, a
 * closed details' content past its summary, content-visibility: hidden content
 * and SVG definitions. With `omitUrlDetail`, the person's setting, the URL line
 * shows the page's origin and path only.
 */
export function shadowSnapshotScript(hostSelector: string, maxChars: number, omitUrlDetail = false): string {
  return `(() => {
    const LIMITS = ${JSON.stringify(SHADOW_SNAPSHOT_LIMITS)};
    const urlWithoutDetail = (${urlWithoutDetail.toString()});
    const MAX_CHARS = ${JSON.stringify(maxChars)};
    let matches;
    try { matches = document.querySelectorAll(${JSON.stringify(hostSelector)}); }
    catch { return { problem: 'invalid-selector' }; }
    if (matches.length === 0) return { problem: 'missing-host' };
    if (matches.length > 1) return { problem: 'ambiguous-host' };
    const host = matches[0];
    // Null for closed shadow roots and for the built-in roots of elements such as inputs and videos.
    const root = host.shadowRoot;
    if (!root) return { problem: 'no-open-shadow-root' };
    const editorSelector = '[contenteditable=""],[contenteditable="true" i],[contenteditable="plaintext-only" i]';
    if (host.isContentEditable || host.closest(editorSelector)) return { problem: 'editable-host' };
    const hostStyle = getComputedStyle(host);
    // A boxless host renders through its shadow root, so its nearest boxed ancestor shows whether it is rendered.
    let boxed = host;
    for (let hops = 0; boxed && hops < 100 && getComputedStyle(boxed).display === 'contents'; hops += 1) boxed = boxed.parentElement;
    // content-visibility: hidden, as hidden="until-found" sets, keeps the host's box but renders none of its content.
    if (!boxed || !boxed.checkVisibility() || hostStyle.visibility !== 'visible' || hostStyle.contentVisibility === 'hidden') return { problem: 'hidden-host' };

    const interactive = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]';
    const skipped = new Set(['script', 'style', 'template', 'noscript', 'link', 'meta']);
    // SVG containers whose content is drawn only where something references it, or never.
    const svgUnrendered = new Set(['defs', 'symbol', 'clipPath', 'mask', 'pattern', 'marker', 'linearGradient', 'radialGradient', 'filter', 'title', 'desc', 'metadata']);
    const frames = new Set(['iframe', 'frame', 'object', 'embed', 'fencedframe', 'portal']);
    const fields = new Set(['input', 'textarea', 'select']);
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const safeUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol + '//';
        url.username = '';
        url.password = '';
        url.hash = '';
        url.pathname = url.pathname.replace(/;(jsessionid)=[^;/]*/gi, ';$1=[REDACTED]');
        for (const key of [...url.searchParams.keys()]) {
          if (/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|passphrase|pwd|secret|session|token)/i.test(key)
            || /^(?:sig|signature|jwt|q-signature|x-[a-z0-9]+-signature|hdnt[sla]|key|access[-_]?key|subscription[-_]?key|auth|sid|phpsessid)$/i.test(key)) {
            url.searchParams.set(key, '[REDACTED]');
          }
        }
        return url.href;
      } catch {
        return '';
      }
    };
    const shown = (element, style) => {
      const rect = element.getBoundingClientRect();
      return style.visibility === 'visible' && rect.width > 0 && rect.height > 0;
    };

    const started = performance.now();
    const omissions = new Set();
    const headings = [];
    const controls = [];
    // Open label collectors: each heading or control collects the text rendered inside it, up to 301 characters, and notes a cut.
    const collectors = [];
    const textParts = [];
    let textLength = 0;
    let visits = 0;
    // The time is checked every 64 visits, label nodes included.
    let nextTimeCheck = 64;
    let halted = false;
    let shadowRoots = 1;
    let assignedSlots = 0;
    const pushText = (raw) => {
      // Each piece is cut to what the text and the labels can still take, before whitespace is collapsed.
      const room = MAX_CHARS + 302;
      if (raw.length > room) omissions.add('text-limit');
      const value = raw.slice(0, room).replace(/\\s+/g, ' ');
      for (const collector of collectors) {
        if (value.length > 301 - collector.text.length) collector.cut = true;
        collector.text += value.slice(0, Math.max(0, 301 - collector.text.length));
      }
      if (textLength > MAX_CHARS) return;
      const part = value.slice(0, MAX_CHARS + 1 - textLength);
      textParts.push(part);
      textLength += part.length;
    };
    const privateLabelContent = 'input,textarea,select,option,script,style,' + editorSelector;
    // Label text is read node by node, at most 200 nodes per label and 5,000 per capture, each counted as a visit.
    let labelVisits = 5000;
    // The text of a label element a form field names, without entering fields, options or editors.
    const labelText = (element) => {
      if (element.isContentEditable || element.closest(privateLabelContent)) return '';
      let text = '';
      let budget = 200;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      // Moves past the current node's subtree, or returns null at the end of the label.
      const skipSubtree = () => {
        for (;;) {
          if (walker.nextSibling()) return walker.currentNode;
          if (!walker.parentNode()) return null;
        }
      };
      let node = walker.nextNode();
      while (node && text.length < 300) {
        if (--budget < 0 || --labelVisits < 0) { omissions.add('control-limit'); break; }
        visits += 1;
        if (node.nodeType === Node.ELEMENT_NODE && node.matches(privateLabelContent)) { node = skipSubtree(); continue; }
        if (node.nodeType === Node.TEXT_NODE) text += node.data.slice(0, 301 - text.length) + ' ';
        node = walker.nextNode();
      }
      return text;
    };
    // A form field is named by its label, never by its value; a button-like input's value is its visible label.
    const fieldName = (element) => {
      if (element.matches('input[type="submit" i],input[type="button" i],input[type="reset" i]')) return element.value;
      const aria = element.getAttribute('aria-label');
      if (clean(aria)) return aria;
      const scope = element.getRootNode();
      const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).slice(0, 5)
        .map((id) => typeof scope.getElementById === 'function' ? scope.getElementById(id) : null).filter(Boolean).map(labelText).join(' ');
      if (clean(labelledBy)) return labelledBy;
      const labels = element.labels ? [...element.labels].slice(0, 2).map(labelText).join(' ') : '';
      if (clean(labels)) return labels;
      return element.getAttribute('title') || element.getAttribute('placeholder') || '';
    };
    // Lists a control, naming it only while the list has room; a name over 300 characters is cut and reported.
    const addControl = (element, name) => {
      if (controls.length >= LIMITS.controls) { omissions.add('control-limit'); return; }
      const label = clean(name());
      if (label.length > 300) omissions.add('control-limit');
      const role = element.getAttribute('role') || element.localName;
      const href = element instanceof HTMLAnchorElement ? ' href=' + JSON.stringify(safeUrl(element.href)) : '';
      const state = (element.matches(':disabled') ? ' disabled' : '') + (element.checked ? ' checked' : '');
      controls.push(role + ' ' + JSON.stringify(label.slice(0, 300)) + href + state);
    };

    const walk = (node, depth, textVisible) => {
      if (halted) return;
      if (visits >= LIMITS.nodes) { omissions.add('node-limit'); halted = true; return; }
      if (visits >= nextTimeCheck) {
        nextTimeCheck = visits + 64;
        if (performance.now() - started > LIMITS.durationMs) { omissions.add('duration-limit'); halted = true; return; }
      }
      visits += 1;
      if (depth > LIMITS.depth) { omissions.add('depth-limit'); return; }
      if (node.nodeType === Node.TEXT_NODE) {
        if (!textVisible) return;
        // Whitespace only separates words; the text is collapsed at the end.
        if (!node.data.trim()) { pushText(' '); return; }
        // Text outside the rendered tree, such as a light child no slot takes, has no boxes.
        const range = document.createRange();
        range.selectNodeContents(node);
        if (range.getClientRects().length) pushText(node.data);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node;
      const name = element.localName;
      if (skipped.has(name) || (element.namespaceURI === 'http://www.w3.org/2000/svg' && svgUnrendered.has(name))) return;
      const style = getComputedStyle(element);
      if (style.display === 'none') return;
      // Without a box, an element is not rendered: unassigned to any slot, inside a closed or built-in shadow root, or hidden content.
      if (style.display !== 'contents' && !element.checkVisibility()) return;
      if (frames.has(name)) { omissions.add('frames'); return; }
      const ownText = style.visibility === 'visible';
      if (element.isContentEditable || element.matches(editorSelector)) {
        omissions.add('private-editors');
        if (element.matches(interactive) && shown(element, style)) {
          addControl(element, () => element.getAttribute('aria-label') || element.getAttribute('title') || '');
        }
        return;
      }
      if (fields.has(name)) {
        if (shown(element, style)) addControl(element, () => fieldName(element));
        return;
      }
      if (name === 'slot') {
        // A slot given a box can hide its content like any element.
        if (style.contentVisibility === 'hidden') return;
        const assigned = element.assignedNodes();
        if (assigned.length) assignedSlots += 1;
        for (const child of assigned.length ? assigned : element.childNodes) {
          if (halted) break;
          walk(child, depth + 1, ownText);
        }
        return;
      }
      const heading = /^h[1-3]$/.test(name) && shown(element, style);
      const control = element.matches(interactive) && shown(element, style);
      const collector = heading || control ? { text: '', cut: false } : undefined;
      if (collector) collectors.push(collector);
      const block = name === 'br' || /^(block|flow-root|flex|grid|list-item|table)/.test(style.display);
      if (block) pushText(' ');
      if (element.shadowRoot) shadowRoots += 1;
      // Rendered elements can still skip their content: a closed details shows only its summary,
      // and content-visibility: hidden, as hidden="until-found" sets, shows none of it.
      let children = (element.shadowRoot || element).childNodes;
      if (style.contentVisibility === 'hidden') children = [];
      else if (name === 'details' && !element.open) {
        let summary = element.firstElementChild;
        while (summary && summary.localName !== 'summary') summary = summary.nextElementSibling;
        children = summary ? [summary] : [];
      }
      for (const child of children) {
        if (halted) break;
        walk(child, depth + 1, ownText);
      }
      if (block) pushText(' ');
      if (!collector) return;
      collectors.splice(collectors.indexOf(collector), 1);
      if (heading) {
        const text = clean(collector.text);
        if (collector.cut || text.length > 300) omissions.add('heading-limit');
        if (text && headings.length >= LIMITS.headings) omissions.add('heading-limit');
        else if (text) headings.push(name + ': ' + text.slice(0, 300));
      }
      if (control) {
        const ownName = element.getAttribute('aria-label') || element.getAttribute('title');
        if (!ownName && collector.cut) omissions.add('control-limit');
        addControl(element, () => ownName || collector.text);
      }
    };
    for (const child of root.childNodes) {
      if (halted) break;
      walk(child, 1, true);
    }

    const hostTag = host.localName.slice(0, 100);
    const lines = [];
    let length = 0;
    const add = (line) => {
      const separator = lines.length ? 1 : 0;
      if (length + separator + line.length > MAX_CHARS) {
        omissions.add('text-limit');
        const room = MAX_CHARS - length - separator;
        if (room > 0) { lines.push(line.slice(0, room)); length = MAX_CHARS; }
        return;
      }
      lines.push(line);
      length += separator + line.length;
    };
    const walkLimits = ['node-limit', 'depth-limit', 'duration-limit', 'heading-limit', 'control-limit'].filter((reason) => omissions.has(reason));
    add('SCOPE: open shadow root of <' + hostTag + '>; read-only, no refs; content outside it, closed shadow roots and frames are not included');
    if (walkLimits.length) add('INCOMPLETE: stopped at ' + walkLimits.join(', ') + '; a heading, control or text missing here may still exist');
    const left = [omissions.has('frames') ? 'frames' : '', omissions.has('private-editors') ? 'editor content' : ''].filter(Boolean);
    if (left.length) add('NOT READ: ' + left.join(', '));
    add(${omitUrlDetail} ? 'URL: ' + urlWithoutDetail(location.href) + ' ' + ${JSON.stringify(URL_DETAIL_OMITTED_NOTE)} : 'URL: ' + safeUrl(location.href));
    add('TITLE: ' + document.title);
    for (const heading of headings) add(heading);
    for (const control of controls) add(control);
    const text = clean(textParts.join(''));
    if (textLength > MAX_CHARS) omissions.add('text-limit');
    if (text) add('TEXT: ' + text);
    return { hostTag, text: lines.join('\\n'), omissions: [...omissions], shadowRoots, assignedSlots };
  })()`
}
