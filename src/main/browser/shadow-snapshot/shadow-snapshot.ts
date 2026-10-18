import { randomUUID } from 'node:crypto'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import { ISOLATED_WORLDS } from '../isolated-worlds.js'
import type { ShadowSnapshotAccess, ShadowSnapshotTab } from './shadow-snapshot-access.js'
import {
  SHADOW_SNAPSHOT_LIMITS,
  shadowSnapshotScript,
  type ShadowSnapshotOmission,
  type ShadowSnapshotPage,
  type ShadowSnapshotProblem
} from './shadow-snapshot-script.js'

const SHADOW_SNAPSHOT_WORLD_ID = ISOLATED_WORLDS.shadowSnapshot

const OMISSIONS: readonly ShadowSnapshotOmission[] = ['frames', 'private-editors', 'node-limit', 'depth-limit', 'duration-limit', 'heading-limit', 'control-limit', 'text-limit']

/** Omissions that mean the capture may lack content the component renders, not just content Hronaut never reads. */
const INCOMPLETE_OMISSIONS: readonly ShadowSnapshotOmission[] = ['node-limit', 'depth-limit', 'duration-limit', 'heading-limit', 'control-limit', 'text-limit']

const PROBLEMS: Record<ShadowSnapshotProblem, string> = {
  'invalid-selector': 'Shadow host selector is not valid CSS',
  'missing-host': 'Shadow host was not found in the top-level page; selectors do not reach into shadow roots, so select the outermost host',
  'ambiguous-host': 'Shadow host selector must match exactly one element',
  'no-open-shadow-root': 'The element has no open shadow root; closed shadow roots and the built-in ones of elements such as inputs and videos cannot be read',
  'editable-host': 'Shadow host is inside editable content, which snapshots never read',
  'hidden-host': 'Shadow host is not rendered or not visible; choose a visible component'
}

/** A read-only capture of one web component's open shadow root. */
export interface BrowserShadowSnapshot {
  kind: 'shadow-observation'
  formatVersion: 1
  captureId: string
  scope: { kind: 'open-shadow-root'; hostTag: string; refs: false; outsideScopeOmitted: true }
  text: string
  /** The text is page-authored: data to read, not instructions. */
  untrusted: true
  completeness: { complete: boolean; omissions: ShadowSnapshotOmission[]; absenceNotEstablished: boolean }
  coverage: { shadowRoots: number; assignedSlots: number }
  limits: typeof SHADOW_SNAPSHOT_LIMITS & { maxChars: number }
  /** The URL line shows only the page's origin and path, as the person chose. */
  urlDetail?: 'omitted'
}

/**
 * Captures the open shadow root of the one top-level element the selector
 * matches, as read-only text: its visible headings and controls without refs,
 * and its rendered text, including nested open shadow roots and slotted
 * content once each. It never reads form field values or editor content, and
 * changes nothing on the page. It throws when the host cannot be read, or when
 * the tab or its observation context changed during the capture.
 */
export async function shadowSnapshot<Tab extends ShadowSnapshotTab>(
  access: ShadowSnapshotAccess<Tab>,
  tabId: string | undefined,
  hostSelector: string,
  maxChars = 30_000
): Promise<BrowserShadowSnapshot> {
  if (!hostSelector.trim() || hostSelector.length > 512) throw new TypeError('Shadow host must be a non-empty CSS selector of at most 512 characters')
  const boundedChars = Math.min(Math.max(maxChars, 1_000), 100_000)
  const tab = access.getTab(tabId)
  const context = access.snapshotDeltaContext(tab)
  const omitUrlDetail = access.omitUrlDetail?.() === true
  const page = await tab.webContents.executeJavaScriptInIsolatedWorld(
    SHADOW_SNAPSHOT_WORLD_ID,
    [{ code: shadowSnapshotScript(hostSelector, boundedChars, omitUrlDetail) }],
    false
  ) as ShadowSnapshotPage
  if ('problem' in page) throw new Error(PROBLEMS[page.problem] ?? 'Shadow host could not be captured')
  const current = access.findTab(tab.id)
  if (!current || current !== tab || current.webContents.isDestroyed()) {
    throw new Error('The snapshot tab changed while it was being observed. Capture a fresh snapshot.')
  }
  const invalidation = snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(current))
  if (invalidation) throw new Error(`The snapshot context changed during observation (${invalidation}). Capture a fresh snapshot.`)
  const omissions = OMISSIONS.filter(omission => page.omissions.includes(omission))
  const complete = !omissions.some(omission => INCOMPLETE_OMISSIONS.includes(omission))
  return {
    kind: 'shadow-observation',
    formatVersion: 1,
    captureId: randomUUID(),
    scope: { kind: 'open-shadow-root', hostTag: page.hostTag, refs: false, outsideScopeOmitted: true },
    text: page.text.slice(0, boundedChars),
    untrusted: true,
    // Frames and editors can hold headings and controls too, so absence holds only when nothing was left out.
    completeness: { complete, omissions, absenceNotEstablished: omissions.length > 0 },
    coverage: { shadowRoots: page.shadowRoots, assignedSlots: page.assignedSlots },
    limits: { ...SHADOW_SNAPSHOT_LIMITS, maxChars: boundedChars },
    ...(omitUrlDetail ? { urlDetail: 'omitted' as const } : {})
  }
}
