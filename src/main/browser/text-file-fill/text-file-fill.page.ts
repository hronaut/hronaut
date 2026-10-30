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

/** The field the target checks found, or why the target cannot take the text. */
export type TextFileFillTarget = { element: HTMLInputElement | HTMLTextAreaElement; field: TextFileFillField } | { problem: TextFileFillTargetProblem }

type TargetChecks = (target: { ref?: string; selector?: string }, length: number, lineBreaks: boolean, expectedOrigin: string) => TextFileFillTarget

/**
 * Runs in the fill's isolated world: resolves the target in the top-level document and returns a problem when it is
 * not exactly one plain text input or textarea, enabled, writable and visible, that takes text of this shape whole (no
 * line breaks in a text input, nothing past maxlength); otherwise the element and its kind of field.
 */
export function textFileFillTargetInPage(target: { ref?: string; selector?: string }, length: number, lineBreaks: boolean, expectedOrigin: string): TextFileFillTarget {
  if (location.origin !== expectedOrigin) return { problem: 'wrong-origin' }
  let matches: NodeListOf<Element>
  try {
    matches = document.querySelectorAll(target.ref ? '[data-hronaut-ref="' + CSS.escape(target.ref) + '"]' : target.selector as string)
  } catch {
    return { problem: 'invalid-selector' }
  }
  if (matches.length === 0) return { problem: 'not-found' }
  if (matches.length > 1) return { problem: 'ambiguous' }
  const element = matches[0]
  const field = element instanceof HTMLTextAreaElement ? 'textarea'
    : element instanceof HTMLInputElement && element.type === 'text' ? 'input' : null
  if (!field) return { problem: 'not-fillable' }
  const fillable = element as HTMLInputElement | HTMLTextAreaElement
  if (fillable.matches(':disabled')) return { problem: 'disabled' }
  if (fillable.readOnly) return { problem: 'readonly' }
  const style = getComputedStyle(fillable)
  const rect = fillable.getBoundingClientRect()
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse' || rect.width <= 0 || rect.height <= 0) {
    return { problem: 'hidden' }
  }
  // A text input drops line breaks, and a person could not type past maxlength: refuse rather than change the text.
  if (lineBreaks && field === 'input') return { problem: 'single-line' }
  if (fillable.maxLength >= 0 && length > fillable.maxLength) return { problem: 'too-long' }
  return { element: fillable, field }
}

/** Runs in the fill's isolated world: checks the target for text of this shape, before the text itself goes to the page. */
export function textFileFillCheckInPage(
  target: { ref?: string; selector?: string },
  length: number,
  lineBreaks: boolean,
  expectedOrigin: string,
  targetChecks: TargetChecks
): TextFileFillCheck {
  const checked = targetChecks(target, length, lineBreaks, expectedOrigin)
  if ('problem' in checked) return checked
  return { field: checked.field }
}

/**
 * Runs in the fill's isolated world: unless it starts after the deadline (epoch milliseconds), when Hronaut may already
 * have given up on it, checks the target again and, in the same task, replaces the field's value with the text and fires
 * input and change as browser_type does. It then reads the field once the page's handlers and a task after them ran,
 * and again settleMs later, and compares both reads with the text. The value setter and getter are Chromium's own,
 * read from the isolated world's prototypes rather than any the page defined.
 */
export async function textFileFillInPage(
  target: { ref?: string; selector?: string },
  text: string,
  expectedOrigin: string,
  deadline: number,
  settleMs: number,
  targetChecks: TargetChecks
): Promise<TextFileFillPageResult> {
  if (Date.now() > deadline) return { problem: 'late' }
  const checked = targetChecks(target, text.length, text.includes('\n'), expectedOrigin)
  if ('problem' in checked) return checked
  const { element, field } = checked
  const value = Object.getOwnPropertyDescriptor(field === 'input' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, 'value')!
  value.set!.call(element, text)
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }))
  element.dispatchEvent(new Event('change', { bubbles: true }))
  // A message task runs after the page's handlers and the microtasks they queued.
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(null)
  })
  const first = value.get!.call(element) as string
  // A page that rewrites the value from a timer, such as an input mask or a debounced formatter, shows here.
  await new Promise((resolve) => setTimeout(resolve, settleMs))
  const last = value.get!.call(element) as string
  return { field, matched: first === text && last === text, connected: element.isConnected && element.ownerDocument === document, fieldCharacters: last.length }
}
