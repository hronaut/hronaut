/**
 * The page script for an agent's fill from a text file. It runs in the
 * fill's own isolated world, which shares the page's DOM but not its scripts,
 * so the value setter and getter it uses are Chromium's own rather than any
 * the page defined. It returns what it found and lengths, never the text or
 * the field's value.
 */

/** Why the target cannot take the file's text: each maps to one message in text-file-fill.ts. */
export type TextFileFillTargetProblem =
  'wrong-origin' | 'invalid-selector' | 'not-found' | 'ambiguous' | 'not-fillable' | 'disabled' | 'readonly' | 'hidden' | 'single-line' | 'too-long'

/** The kind of field the text goes into. */
export type TextFileFillField = 'input' | 'textarea'

/** What the fill found: why the target was refused before anything was written, or the field afterwards. */
export type TextFileFillPageResult =
  | { problem: TextFileFillTargetProblem }
  | {
    field: TextFileFillField
    /** The field's value equals the text after the page's input and change handlers and a task after them ran. */
    matched: boolean
    /** The field is still in the page's document. */
    connected: boolean
    /** The value's length afterwards, in UTF-16 code units. */
    fieldCharacters: number
  }

/**
 * Checks that the page is at the expected origin and that the ref or
 * selector names exactly one plain text input or textarea of its top-level
 * document, enabled, writable and visible, that takes the whole text (no line
 * breaks in a text input, nothing past maxlength), then, in the same task,
 * replaces the field's value with the text, fires input and change as
 * browser_type does, lets a task run and compares the value with the text.
 */
export function textFileFillScript(target: { ref?: string; selector?: string }, text: string, expectedOrigin: string): string {
  return `(async () => {
    const target = ${JSON.stringify(target)};
    const text = ${JSON.stringify(text)};
    const lineBreaks = ${JSON.stringify(text.includes('\n'))};
    if (location.origin !== ${JSON.stringify(expectedOrigin)}) return { problem: 'wrong-origin' };
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
    if (lineBreaks && field === 'input') return { problem: 'single-line' };
    if (element.maxLength >= 0 && text.length > element.maxLength) return { problem: 'too-long' };
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
    const after = value.get.call(element);
    return { field, matched: after === text, connected: element.isConnected && element.ownerDocument === document, fieldCharacters: after.length };
  })()`
}
