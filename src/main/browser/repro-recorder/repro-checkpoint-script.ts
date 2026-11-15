import type { BrowserReproElementCheckpointInput } from '../../../shared/repro-checkpoint.js'
import { MAX_REPRO_COUNT, MAX_REPRO_COUNT_NODES, validReproCount, validReproCountSelector } from '../../../shared/repro-count.js'
import { pageScript } from '../../../shared/page-script.js'
import { renderedVisibilityInPage } from '../rendered-visibility.page.js'
import { reproCheckpointInPage } from './repro-checkpoint.page.js'

export type { ReproCheckpointPageResult } from './repro-checkpoint.page.js'

/** Checks a reviewed Repro checkpoint in the page; see reproCheckpointInPage. */
export function reproCheckpointScript(request: BrowserReproElementCheckpointInput): string {
  const validCount = validReproCountSelector(request.selector) && validReproCount(request.count)
  return pageScript(reproCheckpointInPage, request, validCount, MAX_REPRO_COUNT_NODES, MAX_REPRO_COUNT, renderedVisibilityInPage)
}
