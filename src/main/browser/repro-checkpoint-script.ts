import { renderedVisibilityHelpersSource } from './rendered-visibility.js'
import type { BrowserReproElementCheckpointInput } from '../../shared/repro-checkpoint.js'
import { MAX_REPRO_COUNT, MAX_REPRO_COUNT_NODES, validReproCount, validReproCountSelector } from '../../shared/repro-count.js'
import { javascriptLiteral } from '../../shared/javascript-literal.js'

export function reproCheckpointScript(request: BrowserReproElementCheckpointInput): string {
  return `(() => {
    const request = ${javascriptLiteral(request)};
    if (request.condition === 'count') {
      if (!${validReproCountSelector(request.selector) && validReproCount(request.count)}) return { error: 'invalid-selector' };
      let actual = 0;
      let visited = 0;
      const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
      let element;
      while ((element = walker.nextNode())) {
        if (++visited > ${MAX_REPRO_COUNT_NODES}) return { error: 'count-node-limit' };
        if (!element.matches(request.selector)) continue;
        if (element.matches('iframe,frame,input,textarea,select,[contenteditable]') || element.isContentEditable
          || element.closest('[contenteditable]')) return { error: 'excluded-target' };
        if (++actual > ${MAX_REPRO_COUNT}) return { error: 'count-match-limit' };
      }
      return { selector: request.selector, tag: request.selector.split(' > ').at(-1).split(':')[0], observedMatch: actual === request.count };
    }
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
    ${renderedVisibilityHelpersSource()}
    let visible = false;
    if (request.condition === 'visible' || request.condition === 'hidden') {
      try { visible = renderedVisible(element); }
      catch (error) { if (error === renderedVisibilityLimit) return { error: 'visibility-limit' }; throw error; }
    }
    const normalized = value => String(value).replace(/[\\u200b\\u00ad]/g, '').replace(/\\s+/g, ' ').trim();
    let observedText = '';
    if (request.condition === 'text' && !element.matches('script,style') && !element.closest('head')) {
      // Match exported Playwright text assertions without collecting executable/style text.
      // Playwright includes open-shadow text even for a css:light target.
      // Reject that boundary rather than inspect content outside the recorder's scope.
      if (element.shadowRoot) return { error: 'shadow-text-target' };
      const textLimit = {};
      const shadowTextTarget = {};
      let visited = 0;
      try {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
          acceptNode: node => {
            if (++visited > 2000) throw textLimit;
            if (!(node instanceof Element)) return NodeFilter.FILTER_ACCEPT;
            if (node.matches('script,style')) return NodeFilter.FILTER_REJECT;
            if (node.shadowRoot) throw shadowTextTarget;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let current;
        while ((current = walker.nextNode())) {
          if (current.nodeType !== Node.TEXT_NODE) continue;
          const text = current.nodeValue || '';
          if (observedText.length + text.length > 64000) throw textLimit;
          observedText += text;
        }
      } catch (error) {
        if (error === textLimit) return { error: 'text-limit' };
        if (error === shadowTextTarget) return { error: 'shadow-text-target' };
        throw error;
      }
    }
    const observedMatch = checkedCondition ? element.checked === (request.condition === 'checked')
      : request.condition === 'visible' ? visible
      : request.condition === 'hidden' ? !visible
      : normalized(observedText) === normalized(request.text);
    return { selector, tag: element.localName, observedMatch };
  })()`
}
