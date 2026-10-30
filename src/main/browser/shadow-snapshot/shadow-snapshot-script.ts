import { pageScript } from '../../../shared/page-script.js'
import { URL_DETAIL_OMITTED_NOTE, urlWithoutDetail } from '../../../shared/url-detail.js'
import { shadowSnapshotInPage } from './shadow-snapshot.page.js'

/** Hard bounds of one shadow snapshot's walk and lists. */
export const SHADOW_SNAPSHOT_LIMITS = { nodes: 10_000, depth: 100, durationMs: 500, headings: 80, controls: 500 } as const

/** Content a shadow snapshot left out, by policy or because a bound stopped it. */
export type ShadowSnapshotOmission =
  | 'frames'
  | 'private-editors'
  | 'node-limit'
  | 'depth-limit'
  | 'duration-limit'
  | 'heading-limit'
  | 'control-limit'
  | 'text-limit'

/** Why the host cannot be captured: each maps to one message in shadow-snapshot.ts. */
export type ShadowSnapshotProblem = 'invalid-selector' | 'missing-host' | 'ambiguous-host' | 'no-open-shadow-root' | 'editable-host' | 'hidden-host'

/** What the page script returns: the capture's text and what it left out, or why there is none. */
export type ShadowSnapshotPage =
  | { problem: ShadowSnapshotProblem }
  | { hostTag: string; text: string; omissions: ShadowSnapshotOmission[]; shadowRoots: number; assignedSlots: number }

/**
 * Reads the open shadow root of the one top-level element the selector
 * matches, in the order the page renders it: nested open shadow roots in
 * place of their hosts' children, and each slot's assigned nodes once, or its
 * fallback content when nothing is assigned. It lists the visible headings and
 * controls a snapshot lists, without refs, and the rendered text. Form field
 * values and editor content are never read, and frames, closed shadow roots
 * and built-in ones such as a video's controls are not entered. Content that
 * is not rendered is left out: a light child no slot takes, hidden elements, a
 * closed details' content past its summary, content-visibility: hidden content
 * and SVG definitions. With `omitUrlDetail`, the person's setting, the URL line
 * shows the page's origin and path only.
 */
export function shadowSnapshotScript(hostSelector: string, maxChars: number, omitUrlDetail = false): string {
  return pageScript(shadowSnapshotInPage, { hostSelector, maxChars, limits: SHADOW_SNAPSHOT_LIMITS, omitUrlDetail, urlDetailNote: URL_DETAIL_OMITTED_NOTE }, urlWithoutDetail)
}
