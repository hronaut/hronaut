import { pageScript } from '../../../shared/page-script.js'
import { BROWSER_SNAPSHOT_FORMAT_VERSION } from '../../../shared/snapshot.js'
import { URL_DETAIL_OMITTED_NOTE, urlWithoutDetail } from '../../../shared/url-detail.js'
import { renderedVisibilityInPage } from '../rendered-visibility.page.js'
import { snapshotTextInPage } from '../snapshot-text.page.js'
import { snapshotInPage } from './snapshot.page.js'

// Bounds numbering for one long-lived document. Exhaustion restarts numbering
// with fresh identities; the next delta then reports renumbered controls.
export const SNAPSHOT_REF_LIMIT = 1_000_000

/** With `omitUrlDetail`, the person's setting, the URL line shows the page's origin and path only. */
export function snapshotScript(maxChars: number, rootSelector?: string, omitUrlDetail = false): string {
  return pageScript(
    snapshotInPage,
    { maxChars, rootSelector: rootSelector ?? null, omitUrlDetail, urlDetailNote: URL_DETAIL_OMITTED_NOTE, refLimit: SNAPSHOT_REF_LIMIT, formatVersion: BROWSER_SNAPSHOT_FORMAT_VERSION },
    snapshotTextInPage,
    renderedVisibilityInPage,
    urlWithoutDetail
  )
}
