/**
 * Page scripts for an agent's fill from a text file. They run in the fill's
 * own isolated world, which shares the page's DOM but not its scripts, so the
 * value setter and getter they use are Chromium's own rather than any the
 * page defined. The check script is given only the text's length and whether
 * it has line breaks; the fill script carries the text. Both return what they
 * found and lengths, never the text or the field's value.
 */

import { javascriptLiteral } from '../../../shared/javascript-literal.js'

/** Why the target cannot take the file's text: each maps to one message in text-file-fill.ts. */
export type TextFileFillTargetProblem =
  'wrong-origin' | 'invalid-selector' | 'not-found' | 'ambiguous' | 'not-fillable' | 'disabled' | 'readonly' | 'hidden' | 'single-line' | 'too-long' | 'late'

/** The kind of field the text goes into. */
export type TextFileFillField = 'input' | 'textarea'

/** The field the check found, or why the target cannot take the text. */
export type TextFileFillCheck = { field: TextFileFillField } | { problem: TextFileFillTargetProblem }

/** What the fill found: why the target was refused before anything was written, or the field afterwards. */
export type TextFileFillPageResult =
  | { problem: TextFileFillTargetProblem }
  | {
    field: TextFileFillField
    /** The field's value equaled the text once the page's input and change handlers ran, and again a settle time later. */
    matched: boolean
    /** The field is still in the page's document. */
    connected: boolean
    /** The value's length at the end, in UTF-16 code units. */
    fieldCharacters: number
  }

/** How long the fill waits after the page's handlers before reading the field a second time. */
const SETTLE_MS = 250

/**
 * Page code that resolves the target in the top-level document and returns a
 * problem when it is not exactly one plain text input or textarea, enabled,
 * writable and visible, that takes text of this shape whole (no line breaks
 * in a text input, nothing past maxlength); otherwise it leaves `element` and
 * `field` set.
 */
function targetChecks(target: { ref?: string; selector?: string }, shape: { length: number; lineBreaks: boolean }, expectedOrigin: string): string {
  return `
    const target = ${javascriptLiteral(target)};
    if (location.origin !== ${javascriptLiteral(expectedOrigin)}) return { problem: 'wrong-origin' };
    let matches;
    try {
      matches = document.querySelectorAll(target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector);
    } catch {
      return { problem: 'invalid-selector' };
    }
    if (matches.length === 0) return { problem: 'not-found' };
    if (matches.length > 1) return { problem: 'ambiguous' };
    const element = matches[0];
    const field = element instanceof HTMLTextAreaElement ? 'textarea'
      : element instanceof HTMLInputElement && element.type === 'text' ? 'input' : null;
    if (!field) return { problem: 'not-fillable' };
    if (element.matches(':disabled')) return { problem: 'disabled' };
    if (element.readOnly) return { problem: 'readonly' };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) {
      return { problem: 'hidden' };
    }
    // A text input drops line breaks, and a person could not type past maxlength: refuse rather than change the text.
    if (${javascriptLiteral(shape.lineBreaks)} && field === 'input') return { problem: 'single-line' };
    if (element.maxLength >= 0 && ${javascriptLiteral(shape.length)} > element.maxLength) return { problem: 'too-long' };`
}

/** Checks the target for text of this shape, before the text itself goes to the page. */
export function textFileFillCheckScript(target: { ref?: string; selector?: string }, shape: { length: number; lineBreaks: boolean }, expectedOrigin: string): string {
  return `(() => {${targetChecks(target, shape, expectedOrigin)}
    return { field };
  })()`
}

/**
 * Unless it starts after the deadline (epoch milliseconds), when Hronaut may
 * already have given up on it, checks the target again and, in the same
 * task, replaces the field's value with the text and fires input and change
 * as browser_type does. It then reads the field once the page's handlers and
 * a task after them ran, and again SETTLE_MS later, and compares both reads
 * with the text.
 */
export function textFileFillScript(target: { ref?: string; selector?: string }, text: string, expectedOrigin: string, deadline: number): string {
  return `(async () => {
    if (Date.now() > ${javascriptLiteral(deadline)}) return { problem: 'late' };
    const text = ${javascriptLiteral(text)};${targetChecks(target, { length: text.length, lineBreaks: text.includes('\n') }, expectedOrigin)}
    const value = Object.getOwnPropertyDescriptor(field === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value');
    value.set.call(element, text);
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    // A message task runs after the page's handlers and the microtasks they queued.
    await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve();
      channel.port2.postMessage(null);
    });
    const first = value.get.call(element);
    // A page that rewrites the value from a timer, such as an input mask or a debounced formatter, shows here.
    await new Promise((resolve) => setTimeout(resolve, ${SETTLE_MS}));
    const last = value.get.call(element);
    return { field, matched: first === text && last === text, connected: element.isConnected && element.ownerDocument === document, fieldCharacters: last.length };
  })()`
}
