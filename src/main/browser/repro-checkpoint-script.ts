import type { BrowserReproCheckpointInput } from '../../shared/repro-checkpoint.js'
import { javascriptLiteral } from '../../shared/javascript-literal.js'

export function reproCheckpointScript(request: BrowserReproCheckpointInput): string {
  return `(() => {
    const request = ${javascriptLiteral(request)};
    const matches = document.querySelectorAll(request.selector);
    if (matches.length !== 1) throw new Error('Checkpoint requires exactly one current light-DOM element');
    const element = matches[0];
    if (element.matches('iframe,frame,input,textarea,select') || element.isContentEditable
      || element.querySelector('input,textarea,select,[contenteditable]')) {
      throw new Error('Choose a non-editable result element; form values and frame contents are excluded');
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
    if (!selector) throw new Error('No safe unique checkpoint selector is available');
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const visible = style.visibility !== 'hidden' && style.visibility !== 'collapse' && rect.width > 0 && rect.height > 0;
    const normalized = value => String(value).replace(/\\s+/g, ' ').trim();
    const observedMatch = request.condition === 'visible' ? visible
      : request.condition === 'hidden' ? !visible
      : normalized(element.textContent || '') === normalized(request.text);
    return { selector, tag: element.localName, observedMatch };
  })()`
}
