/**
 * Page scripts for an agent's fill from a text file. They run in the fill's
 * own isolated world, which shares the page's DOM but not its scripts, so the
 * value setter and getter they use are Chromium's own rather than any the
 * page defined. The check script is given only the text's length and whether
 * it has line breaks; the fill script carries the text. Both return what they
 * found and lengths, never the text or the field's value.
 */

import { pageScript } from '../../../shared/page-script.js'
import { textFileFillCheckInPage, textFileFillInPage, textFileFillTargetInPage } from './text-file-fill.page.js'

export type { TextFileFillCheck, TextFileFillField, TextFileFillPageResult, TextFileFillTargetProblem } from './text-file-fill.page.js'

/** How long the fill waits after the page's handlers before reading the field a second time. */
const SETTLE_MS = 250

/** Checks the target for text of this shape, before the text itself goes to the page. */
export function textFileFillCheckScript(target: { ref?: string; selector?: string }, shape: { length: number; lineBreaks: boolean }, expectedOrigin: string): string {
  return pageScript(textFileFillCheckInPage, target, shape.length, shape.lineBreaks, expectedOrigin, textFileFillTargetInPage)
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
  return pageScript(textFileFillInPage, target, text, expectedOrigin, deadline, SETTLE_MS, textFileFillTargetInPage)
}
