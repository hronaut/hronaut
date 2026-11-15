import { pageScript } from '../../../shared/page-script.js'
import {
  clickTargetInPage,
  dialogAwareClickInPage,
  dialogAwareCoordinateClickInPage,
  dialogAwareEvaluateInPage,
  dragPointsInPage,
  editabilityFailureInPage,
  fillFormInPage,
  heldTextInPage,
  overrideDialogsInPage,
  releaseEvaluationDialogsInPage,
  selectTargetInPage,
  targetElementInPage,
  targetPointInPage,
  targetStateInPage,
  typeTargetInPage,
  writeTypedTextInPage
} from './target-action.page.js'

export function targetActionScript(
  action: 'click' | 'type' | 'select',
  target: { ref?: string; selector?: string },
  text?: string,
  submit?: boolean
): string {
  if (action === 'click') return pageScript(clickTargetInPage, target, targetElementInPage)
  if (action === 'select') return pageScript(selectTargetInPage, target, text ?? '', targetElementInPage, editabilityFailureInPage)
  return pageScript(typeTargetInPage, target, text ?? '', Boolean(submit), targetElementInPage, editabilityFailureInPage, writeTypedTextInPage, heldTextInPage)
}

export function dialogAwareClickScript(
  target: { ref?: string; selector?: string },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return pageScript(dialogAwareClickInPage, target, action === 'accept', promptText !== undefined, promptText ?? '', targetElementInPage, overrideDialogsInPage)
}

export function dialogAwareCoordinateClickScript(
  point: { x: number; y: number },
  action: 'accept' | 'dismiss',
  promptText?: string
): string {
  return pageScript(dialogAwareCoordinateClickInPage, point, action === 'accept', promptText !== undefined, promptText ?? '', overrideDialogsInPage)
}

/**
 * Page code that ends one evaluation's dialog handling, by its id, also for an
 * evaluation whose call stopped waiting while its script still runs. When no
 * evaluation still handles dialogs, the page's own alert, confirm and prompt
 * come back.
 */
export function releaseEvaluationDialogsScript(id: string): string {
  return pageScript(releaseEvaluationDialogsInPage, id)
}

/**
 * Runs the script with the page's dialogs answered as asked until it settles.
 * Evaluations that overlap, such as one still running after its call stopped
 * waiting, share one set of handlers that follows the latest evaluation and
 * keep the page's own dialogs to restore when the last one ends.
 */
export function dialogAwareEvaluateScript(
  script: string,
  action: 'accept' | 'dismiss',
  id: string
): string {
  return pageScript(dialogAwareEvaluateInPage, script, action === 'accept', id, releaseEvaluationDialogsInPage)
}

/** An expression for the element the target names, or null. */
export function targetExpression(target: { ref?: string; selector?: string }): string {
  return pageScript(targetElementInPage, target)
}

export function targetStateScript(
  target: { ref?: string; selector?: string },
  state: 'attached' | 'detached' | 'visible' | 'hidden'
): string {
  return pageScript(targetStateInPage, target, state, targetElementInPage)
}

export interface BrowserFormField {
  ref?: string
  selector?: string
  value: string | boolean
}

export function fillFormScript(fields: BrowserFormField[]): string {
  return pageScript(fillFormInPage, fields, targetElementInPage, editabilityFailureInPage, writeTypedTextInPage, heldTextInPage)
}

export function targetPointScript(
  target: { ref?: string; selector?: string },
  options: { rejectNativeDisabled?: boolean } = {}
): string {
  return pageScript(targetPointInPage, target, options.rejectNativeDisabled === true, targetElementInPage)
}

export function dragPointsScript(
  source: { ref?: string; selector?: string },
  target: { ref?: string; selector?: string }
): string {
  return pageScript(dragPointsInPage, source, target, targetElementInPage)
}
