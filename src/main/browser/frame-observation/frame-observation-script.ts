import { pageScript } from '../../../shared/page-script.js'
import {
  checkAndReleaseHeldFrameInPage,
  frameLinkInPage,
  frameObservationInPage,
  frameSelectorInPage,
  holdSelectedFrameInPage,
  observeHeldFrameInPage,
  readHeldFrameInPage,
  releaseHeldFrameInPage
} from './frame-observation.page.js'

// Each script runs only in the observation's private parent isolated world, never in a child's main world, and keeps
// what it holds there under the observation's key.

/** Keeps the one iframe the selector names under the key, and gives it; see frameSelectorInPage. */
export function frameSelectionScript(key: string, selector: string): string {
  return pageScript(holdSelectedFrameInPage, key, selector, frameSelectorInPage)
}

/** Observes the frame held under the key and keeps the observation in its place; see frameObservationInPage. */
export function frameObservationScript(key: string, selector: string, maxChars: number): string {
  return pageScript(observeHeldFrameInPage, key, selector, maxChars, frameObservationInPage, frameLinkInPage)
}

/** The text the observation held under the key read. */
export function frameObservationReadScript(key: string): string {
  return pageScript(readHeldFrameInPage, key)
}

/** Whether the observation held under the key still watches the same frame, closing and forgetting it either way. */
export function frameObservationCheckScript(key: string): string {
  return pageScript(checkAndReleaseHeldFrameInPage, key)
}

/** Closes and forgets what the key holds. */
export function frameReleaseScript(key: string): string {
  return pageScript(releaseHeldFrameInPage, key)
}
