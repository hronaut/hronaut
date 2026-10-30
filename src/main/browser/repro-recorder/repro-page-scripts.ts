import { pageScript } from '../../../shared/page-script.js'
import { snapshotTextInPage } from '../snapshot-text.page.js'
import { reproScrollInPage, reproTargetInPage, type ReproPoint } from './repro-page.page.js'

/** Describes the element a recorded click at the point hit, or without a point the focused element; see reproTargetInPage. */
export function reproTargetScript(point?: ReproPoint): string {
  return pageScript(reproTargetInPage, point, snapshotTextInPage)
}

/** Reads the page's scroll position. */
export function reproScrollScript(): string {
  return pageScript(reproScrollInPage)
}
