import type { BrowserReproCheckpointInput } from '../../shared/repro-checkpoint.js'
import { javascriptLiteral } from '../../shared/javascript-literal.js'

export function reproCheckpointScript(request: BrowserReproCheckpointInput): string {
  return `(() => {
    const request = ${javascriptLiteral(request)};
    let matches;
    try { matches = document.querySelectorAll(request.selector); }
    catch { return { error: 'invalid-selector' }; }
    if (matches.length !== 1) return { error: 'ambiguous-target' };
    const element = matches[0];
    const checkedCondition = request.condition === 'checked' || request.condition === 'unchecked';
    if (checkedCondition && (!(element instanceof HTMLInputElement)
      || !['checkbox', 'radio'].includes(element.type) || element.indeterminate
      || element.closest('[contenteditable]'))) return { error: 'unsupported-checked-target' };
    if (!checkedCondition && (element.matches('iframe,frame,input,textarea,select,[contenteditable]') || element.isContentEditable
      || element.querySelector('input,textarea,select,[contenteditable]'))) {
      return { error: 'excluded-target' };
    }
    const parts = [];
    let node = element;
    let selector = '';
    while (node instanceof Element) {
      const parent = node.parentElement;
      let part = node.localName;
      if (parent) {
        const siblings = [...parent.children].filter(candidate => candidate.localName === node.localName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (candidate.length > 500) break;
      const selected = document.querySelectorAll(candidate);
      if (selected.length === 1 && selected[0] === element) { selector = candidate; break; }
      node = parent;
    }
    if (!selector) return { error: 'unsupported-target' };
    // Match the visibility semantics of the exported Playwright assertion.
    // Boxless display:contents nodes can have rendered descendants. Bound that
    // walk and reject incomplete observations rather than reporting hidden.
    let visits = 0;
    const limit = {};
    const isVisible = (node, depth = 0) => {
      if (++visits > 1000 || depth > 100) throw limit;
      if (node.nodeType === Node.TEXT_NODE) {
        const range = document.createRange();
        range.selectNode(node);
        const rect = range.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }
      if (!(node instanceof Element)) return false;
      const style = getComputedStyle(node);
      if (style.display === 'contents') {
        for (const child of node.childNodes) if (isVisible(child, depth + 1)) return true;
        return false;
      }
      if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) return false;
      if (style.visibility !== 'visible') return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    let visible = false;
    if (request.condition === 'visible' || request.condition === 'hidden') {
      try { visible = isVisible(element); }
      catch (error) { if (error === limit) return { error: 'visibility-limit' }; throw error; }
    }
    const normalized = value => String(value).replace(/\\s+/g, ' ').trim();
    const observedMatch = checkedCondition ? element.checked === (request.condition === 'checked')
      : request.condition === 'visible' ? visible
      : request.condition === 'hidden' ? !visible
      : normalized(element.textContent || '') === normalized(request.text);
    return { selector, tag: element.localName, observedMatch };
  })()`
}
