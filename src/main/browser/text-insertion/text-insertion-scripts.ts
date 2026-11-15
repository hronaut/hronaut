/**
 * Page scripts for an agent's text insertion. They run in the text
 * insertion's own isolated world, which shares the page's DOM but not its
 * scripts, so the page cannot read or replace the state they keep, one record
 * per insertion keyed by its token. They are given only the text's length.
 * The record keeps the editor's content from just before the text is sent, to
 * tell afterwards whether it changed, and the text's events, to tell whether
 * a handler cancelled them, until the insertion is disposed; nothing of either
 * is returned.
 */

import { pageScript } from '../../../shared/page-script.js'
import { textInsertionDisposeInPage, textInsertionLocateInPage, textInsertionObserveInPage } from './text-insertion.page.js'

export type { TextInsertionEditor, TextInsertionLocation, TextInsertionObservation, TextInsertionTargetProblem } from './text-insertion.page.js'

/** How long a guard stays armed at most: longer than the arm check and the text's delivery may take together. */
const GUARD_LIFETIME_MS = 8_000

/**
 * Resolves the one element the ref or selector names in the top-level
 * document and checks that it is a text field, text area or editable region
 * (for an element inside an editable region, its editing host) that is
 * visible, enabled, writable and already focused, with the caret or selection
 * inside it, that a single-line field is not given line breaks, and that a
 * field's length limit leaves room for the whole text. The check phase
 * records the editor under the token. The arm phase checks that the editor is
 * still the recorded one, notes its content and starts the guard: from then
 * until the observation, for at most GUARD_LIFETIME_MS or until the document
 * is hidden, a trusted text insertion aimed at any other element of the
 * document is cancelled, and the insertion's events on the editor and focus
 * leaving it are recorded.
 */
export function textInsertionLocateScript(
  target: { ref?: string; selector?: string },
  token: string,
  phase: 'check' | 'arm',
  text: { length: number; lineBreaks: boolean }
): string {
  return pageScript(textInsertionLocateInPage, target, token, phase, text.length, text.lineBreaks, GUARD_LIFETIME_MS)
}

/**
 * Stops the guard, if it has not expired yet, and reports what the text's events under the token showed.
 * Chromium dispatches them before it acknowledges the text, so the answer
 * waits only briefly for a page that is still busy. Then it lets the page's
 * handlers and a task after them run, and gives an editor that applies the
 * text itself, after cancelling Chromium's insertion, half a second to change
 * its content.
 */
export function textInsertionObserveScript(token: string): string {
  return pageScript(textInsertionObserveInPage, token)
}

/** Stops the guard under the token and forgets the editor's content. */
export function textInsertionDisposeScript(token: string): string {
  return pageScript(textInsertionDisposeInPage, token)
}
