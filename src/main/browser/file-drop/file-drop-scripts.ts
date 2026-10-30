/**
 * Page scripts for a file drop. They run in the file drop's own isolated
 * world, which shares the page's DOM but not its scripts, so the page cannot
 * read or replace the state they keep, one record per drop keyed by its
 * token. They never read the dropped files.
 */

import { pageScript } from '../../../shared/page-script.js'
import { fileDropDisposeInPage, fileDropLocateInPage, fileDropObserveInPage } from './file-drop.page.js'

export type { FileDropLocation, FileDropObservation, FileDropTargetProblem } from './file-drop.page.js'

/**
 * Resolves the one element the ref or selector names in the top-level
 * document, scrolls it to the middle of the viewport and returns its center,
 * after checking that nothing covers it there and that it is not a frame.
 * With install, it starts recording the page's trusted drag events for this
 * drop under the token. Without it, it checks that the element is still the
 * one recorded under the token and restarts the record, so events from
 * another drag before this one's turn do not count.
 */
export function fileDropLocateScript(target: { ref?: string; selector?: string }, token: string, install: boolean): string {
  return pageScript(fileDropLocateInPage, target, token, install)
}

/**
 * Reports what the page's drag events under the token showed once the event
 * the phase waits for arrived, or after two seconds. Chromium delivers drag
 * events to the page on its own schedule, and gives a drag update that moves
 * onto another element (such as an overlay the page showed on dragenter) to
 * the page as a dragenter and dragleave with no dragover. So the enter phase
 * waits for the dragenter or a dragover, the dragover phase for a dragover or
 * a dragenter, and the drop phase for a drop or the dragleave that ends a drag
 * Chromium did not drop; each phase takes the events it waited for, so the
 * next phase waits only for new ones. The answer waits until the page's own
 * handlers for the event have run, so it can tell whether they accepted it.
 */
export function fileDropObserveScript(token: string, phase: 'enter' | 'over' | 'drop'): string {
  return pageScript(fileDropObserveInPage, token, phase)
}

/** Stops recording the page's drag events under the token. */
export function fileDropDisposeScript(token: string): string {
  return pageScript(fileDropDisposeInPage, token)
}
