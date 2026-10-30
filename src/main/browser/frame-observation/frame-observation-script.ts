import { javascriptLiteral } from '../../../shared/javascript-literal.js'
import { pageFunctionSource, pageScript } from '../../../shared/page-script.js'
import { frameLinkInPage, frameObservationInPage, frameSelectorInPage } from './frame-observation.page.js'

/**
 * Runs only in a private parent isolated world, never in a child's main world. `expected` is an expression the world
 * evaluates to the frame the selection found, so the observation is called with it rather than with a literal.
 */
export function frameObservationScript(selector: string, maxChars: number, expected: string): string {
  return `(${pageFunctionSource(frameObservationInPage)})(${javascriptLiteral(selector)}, ${javascriptLiteral(maxChars)}, (${expected}), (${pageFunctionSource(frameLinkInPage)}))`
}

/** The one iframe the selector names; see frameSelectorInPage. */
export function frameSelectorScript(selector: string): string {
  return pageScript(frameSelectorInPage, selector)
}
