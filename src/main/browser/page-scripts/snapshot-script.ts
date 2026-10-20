import { renderedVisibilityHelpersSource } from '../rendered-visibility.js'
import { snapshotTextHelpersSource } from '../snapshot-text.js'
import { javascriptLiteral } from '../../../shared/javascript-literal.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION } from '../../../shared/snapshot.js'
import { URL_DETAIL_OMITTED_NOTE, urlWithoutDetail } from '../../../shared/url-detail.js'

// Bounds numbering for one long-lived document. Exhaustion restarts numbering
// with fresh identities; the next delta then reports renumbered controls.
export const SNAPSHOT_REF_LIMIT = 1_000_000

/** With `omitUrlDetail`, the person's setting, the URL line shows the page's origin and path only. */
export function snapshotScript(maxChars: number, includeMetadata = false, rootSelector?: string, omitUrlDetail = false): string {
  return `(() => {
    const MAX_CHARS = ${maxChars};
    const urlWithoutDetail = (${urlWithoutDetail.toString()});
    ${snapshotTextHelpersSource()}
    const rootSelector = ${javascriptLiteral(rootSelector ?? null)};
    let root = document;
    if (rootSelector !== null) {
      let matches;
      try { matches = document.querySelectorAll(rootSelector); }
      catch { return { scopeError: 'invalid-selector' }; }
      if (matches.length !== 1) return { scopeError: matches.length ? 'ambiguous-root' : 'missing-root' };
      root = matches[0];
      if (root.matches('iframe,frame,input,textarea,select,[contenteditable]') || snapshotEditingContext(root)) return { scopeError: 'unsupported-root' };
    }
    const select = selector => root === document ? [...document.querySelectorAll(selector)]
      : [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];
    const interactive = 'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="checkbox"],[role="radio"],[role="tab"],[contenteditable="true"]';
    const safeUrl = (value) => {
      try {
        const url = new URL(value, location.href);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return url.protocol + '//';
        url.username = '';
        url.password = '';
        url.hash = '';
        url.pathname = url.pathname.replace(/;jsessionid=[^;/]*/gi, ';jsessionid=[REDACTED]');
        for (const key of [...url.searchParams.keys()]) {
          if (/(api[-_]?key|authorization|auth[-_]?token|cookie|credential|csrf|password|passwd|passcode|passphrase|pwd|secret|session|token)/i.test(key)
            || /^(?:sig|signature|jwt|q-signature|x-[a-z0-9]+-signature|hdnt[sla]|key|access_?key|auth|sid|phpsessid)$/i.test(key)) {
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
    if (root !== document) {
      ${renderedVisibilityHelpersSource()}
      // Boxless component roots can have visible descendants. Keep explicit
      // hidden roots excluded and reject an incomplete bounded observation.
      if (getComputedStyle(root).visibility !== 'visible') return { scopeError: 'hidden-root' };
      try { if (!renderedVisible(root)) return { scopeError: 'hidden-root' }; }
      catch (error) { if (error === renderedVisibilityLimit) return { scopeError: 'visibility-limit' }; throw error; }
    }
    // One comparison identity per observed element for this document. Surviving
    // controls keep their ref across captures, so inserting or removing an
    // earlier control does not renumber later ones. The weak map lives in the
    // isolated snapshot world, outside page JavaScript; the DOM attribute is
    // only the published handle and is never read back as identity.
    const identity = globalThis.__hronautSnapshotIdentity
      || (globalThis.__hronautSnapshotIdentity = { next: 0, refs: new WeakMap() });
    if (identity.next > ${SNAPSHOT_REF_LIMIT} - 500) { identity.next = 0; identity.refs = new WeakMap(); }
    for (const element of document.querySelectorAll('[data-hronaut-ref]')) element.removeAttribute('data-hronaut-ref');
    const lines = [];
    // The name of each control the agent was shown, for the shell's plain-words steps such as Clicking "Review order".
    // A form field is named only by its label, never by its value, its text or its options.
    const targetNames = [];
    // Label text is read node by node, at most 200 nodes per label and 5,000 per capture.
    let stepLabelVisits = 5000;
    const stepLabelText = (node) => {
      let text = '';
      let visits = 200;
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      while (text.length < 240 && --visits > 0 && --stepLabelVisits > 0 && walker.nextNode()) {
        if (walker.currentNode.nodeType !== Node.TEXT_NODE) continue;
        const parent = walker.currentNode.parentElement;
        if (!parent || parent.closest('input,textarea,select,option,script,style,[contenteditable]')) continue;
        text += walker.currentNode.textContent + ' ';
      }
      return text;
    };
    const stepTargetName = (element, label) => {
      if (!element.matches('input,textarea,select,[contenteditable]')) return label;
      if (element.matches('input[type="submit" i],input[type="button" i],input[type="reset" i]')) return element.value || label;
      const aria = element.getAttribute('aria-label');
      if (aria && aria.trim()) return aria;
      const labelledBy = String(element.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean).slice(0, 5)
        .map((id) => document.getElementById(id)).filter(Boolean).map(stepLabelText).join(' ');
      if (labelledBy.trim()) return labelledBy;
      const labels = element.labels ? [...element.labels].slice(0, 2).map(stepLabelText).join(' ') : '';
      if (labels.trim()) return labels;
      return element.getAttribute('title') || element.getAttribute('placeholder') || '';
    };
    const omitted = { headings: false, controls: false, bodyText: false, characters: false };
    const add = (line) => {
      if (lines.join('\\n').length + (lines.length ? 1 : 0) + line.length > MAX_CHARS) omitted.characters = true;
      if (lines.join('\\n').length < MAX_CHARS) lines.push(line);
    };
    if (rootSelector !== null) add('SCOPE: component; content outside the root is omitted, including global dialogs and navigation controls');
    add(${omitUrlDetail} ? 'URL: ' + urlWithoutDetail(location.href) + ' ' + ${javascriptLiteral(URL_DETAIL_OMITTED_NOTE)} : 'URL: ' + safeUrl(location.href));
    add('TITLE: ' + document.title);
    const visibleHeadings = select('h1,h2,h3').filter(element => visible(element) && !snapshotEditingContext(element));
    omitted.headings = visibleHeadings.length > 80;
    const headings = visibleHeadings.slice(0, 80);
    for (const heading of headings) {
      const text = snapshotSafeText(heading).replace(/\\s+/g, ' ').trim();
      if (text.length > 300) omitted.headings = true;
      if (text) add(heading.tagName.toLowerCase() + ': ' + text.slice(0, 300));
    }
    const visibleElements = select(interactive).filter(element => visible(element) && !snapshotEditingContext(element.parentElement));
    omitted.controls = visibleElements.length > 500;
    const elements = visibleElements.slice(0, 500);
    for (const element of elements) {
      let ref = identity.refs.get(element);
      if (!ref) { ref = 'e' + (++identity.next); identity.refs.set(element, ref); }
      element.setAttribute('data-hronaut-ref', ref);
      const role = element.getAttribute('role') || element.tagName.toLowerCase();
      const label = element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || snapshotSafeText(element);
      if (String(label).replace(/\\s+/g, ' ').trim().length > 300) omitted.controls = true;
      const href = element instanceof HTMLAnchorElement ? ' href=' + JSON.stringify(safeUrl(element.href)) : '';
      const state = (element.matches(':disabled') ? ' disabled' : '') + (element.checked ? ' checked' : '');
      const shown = lines.length;
      add('[' + ref + '] ' + role + ' ' + JSON.stringify(String(label).replace(/\\s+/g, ' ').trim().slice(0, 300)) + href + state);
      if (lines.length > shown) {
        const name = String(stepTargetName(element, label) || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
        if (name) targetNames.push([ref, name]);
      }
    }
    const bodyText = snapshotSafeText(root === document ? document.body : root).replace(/\\s+/g, ' ').trim();
    omitted.bodyText = bodyText.length > Math.max(0, MAX_CHARS - lines.join('\\n').length - (lines.length ? 1 : 0) - 6);
    if (bodyText) add('TEXT: ' + bodyText.slice(0, Math.max(0, MAX_CHARS - lines.join('\\n').length)));
    if (snapshotTextLimited) omitted.characters = true;
    const text = lines.join('\\n').slice(0, MAX_CHARS);
    if (root !== document && !root.isConnected) return { scopeError: 'detached-root' };
    return ${includeMetadata} ? { ...(rootSelector === null ? {} : { scope: { kind: 'component', rootTag: root.localName, outsideScopeOmitted: true } }), formatVersion: ${BROWSER_SNAPSHOT_FORMAT_VERSION}, text, maxChars: MAX_CHARS, returnedChars: text.length,
      truncated: Object.values(omitted).some(Boolean), omitted, targetNames } : text;
  })()`
}
