import { pageScript } from '../../../shared/page-script.js'
import { SIZING_INPUT_PROPERTIES, sizingInputValue } from '../../../shared/element-sizing-inputs.js'
import { flexContainerContext } from '../../../shared/element-flex-container.js'
import { FORM_VALIDITY_FLAGS } from '../../../shared/form-validity.js'
import { MAX_COMPARED_TEXT_VALUE_LENGTH } from '../../../shared/value-comparison.js'
import { passwordOccupancyInPage } from '../password-occupancy.page.js'
import { sizingInputsInPage, sizingLookupInPage } from '../element-sizing-inputs.page.js'
import { formValidityToken } from '../form-validity.js'
import { formValidityInPage } from '../form-validity.page.js'
import { valueComparisonExpected, valueComparisonToken } from '../value-comparison.js'
import { valueComparisonInPage } from '../value-comparison.page.js'
import { elementScrollGeometryInPage } from '../element-scroll-geometry.page.js'
import { snapshotTextInPage } from '../snapshot-text.page.js'
import {
  cancelElementPickerInPage,
  elementInspectionInPage,
  elementInspectionToolsInPage,
  elementPickerInPage,
  elementPickerInspectionAtPointInPage,
  elementPickerNativeInputInPage,
  playwrightLocatorInPage,
  type InspectionTarget
} from './element-inspection.page.js'

export function elementPickerScript(): string {
  return pageScript(elementPickerInPage, elementInspectionToolsInPage, snapshotTextInPage)
}

export function cancelElementPickerScript(): string {
  return pageScript(cancelElementPickerInPage)
}

export function elementPickerNativeInputScript(
  type: 'down' | 'move' | 'up',
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return pageScript(elementPickerNativeInputInPage, type, x, y, viewportWidth, viewportHeight)
}

export function elementPickerInspectionAtPointScript(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number
): string {
  return pageScript(elementPickerInspectionAtPointInPage, { x, y, viewportWidth, viewportHeight }, elementInspectionToolsInPage, snapshotTextInPage)
}

export function elementInspectionScript(target: InspectionTarget, occupancyToken?: string, expectedValue?: string): string {
  // The flex container context comes with the item's sizing inputs and their guard.
  const sizing = target.includeSizingInputs === true || target.includeFlexContainer === true
  const token = occupancyToken ?? ''
  if (target.includeValidity === true) formValidityToken(token)
  if (expectedValue !== undefined) {
    valueComparisonExpected(expectedValue)
    valueComparisonToken(token)
  }
  return pageScript(
    elementInspectionInPage,
    {
      target,
      token,
      sizing,
      sizingProperties: SIZING_INPUT_PROPERTIES,
      validityFlags: FORM_VALIDITY_FLAGS,
      expected: expectedValue ?? null,
      maxComparedLength: MAX_COMPARED_TEXT_VALUE_LENGTH
    },
    elementInspectionToolsInPage,
    snapshotTextInPage,
    sizingLookupInPage,
    sizingInputsInPage,
    sizingInputValue,
    flexContainerContext,
    passwordOccupancyInPage,
    formValidityInPage,
    valueComparisonInPage,
    elementScrollGeometryInPage
  )
}

export function playwrightLocatorScript(target: { ref?: string; selector?: string }): string {
  return pageScript(playwrightLocatorInPage, target, elementInspectionToolsInPage, snapshotTextInPage)
}
