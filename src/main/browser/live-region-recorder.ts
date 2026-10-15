import type { WebContents } from 'electron'
import type { BrowserLiveRegionAction, BrowserLiveRegionReport } from '../../shared/types.js'
import {
  LIVE_REGION_ERRORS,
  LIVE_REGION_LIMITS,
  liveRegionPageScript,
  type LiveRegionErrorCode
} from '../../shared/live-region.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isHronautHomeUrl } from './url.js'

const LIVE_REGION_WORLD_ID = 1024

export interface BrowserLiveRegionRecordingState {
  active: boolean
  startedAt: string
  observationGeneration: number
}

interface LiveRegionRecordingTab {
  id: string
  title: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
  liveRegionRecording?: BrowserLiveRegionRecordingState
}

interface LiveRegionRecorderHost<T> {
  isCurrent(tab: T): boolean
}

type LiveRegionPageResult =
  | { error: LiveRegionErrorCode }
  | Omit<BrowserLiveRegionReport, 'tabId' | 'title' | 'url' | 'limits' | 'caveats'>

export const LIVE_REGION_CAVEATS = [
  'Selected page text can contain private information. Text is captured only from the region you select, only while recording, and is never persisted, exported, or written to diagnostic logs.',
  'Entries are DOM observations at MutationObserver callback time, not announcements delivered to assistive technology. Synchronous changes between callbacks are coalesced, so intermediate text is not invented and counts are not announcement counts.',
  'Metadata repeats authored role and aria-* tokens only; it is not computed accessibility semantics or an accessible name.',
  'Form fields and values, editable content, scripts, styles, frames, and shadow roots are never read. Text is DOM text, so hidden descendants are included.',
  'A full document navigation, pausing the agent on the tab, a workspace control change, or removal of the selected element stops the recording; it never rebinds to a replacement element.'
]

/** The page stops itself at the duration limit, so an unread expired recording must not hold the tab awake. */
export function liveRegionRecordingKeepsTabAwake(
  tab: Pick<LiveRegionRecordingTab, 'liveRegionRecording' | 'observationGeneration'>,
  now = Date.now()
): boolean {
  const recording = tab.liveRegionRecording
  return !!recording
    && recording.active
    && recording.observationGeneration === tab.observationGeneration
    && now - Date.parse(recording.startedAt) < LIVE_REGION_LIMITS.maxDurationMs
}

/** Owns one selected-region text recording per tab with the same stale-response checks as DOM changes. */
export class BrowserLiveRegionRecorder<T extends LiveRegionRecordingTab> {
  private readonly requests = new WeakMap<T, { action?: symbol; requested: number; applied: number }>()

  constructor(private readonly host: LiveRegionRecorderHost<T>) {}

  async manage(tab: T, action: BrowserLiveRegionAction, selector?: string): Promise<BrowserLiveRegionReport> {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording a live region')
    if (!['start', 'get', 'stop', 'clear'].includes(action)) throw new Error('Unsupported live region action')
    if (action === 'start') {
      const trimmed = selector?.trim() ?? ''
      if (!trimmed || trimmed.length > LIVE_REGION_LIMITS.maxSelectorChars) {
        throw new Error(`Provide a CSS selector of 1 to ${LIVE_REGION_LIMITS.maxSelectorChars} characters to start recording`)
      }
      selector = trimmed
    }

    const observationGeneration = tab.observationGeneration
    const navigationGeneration = tab.navigationGeneration
    const webContents = tab.webContents
    const effectiveAction = tab.liveRegionRecording
      && tab.liveRegionRecording.observationGeneration !== observationGeneration
      && action !== 'start'
      ? 'clear'
      : action
    const requests = this.requests.get(tab) ?? { requested: 0, applied: 0 }
    this.requests.set(tab, requests)
    if (effectiveAction !== 'get') requests.action = Symbol(effectiveAction)
    const recordingAction = requests.action
    const request = ++requests.requested
    const result = await webContents.executeJavaScriptInIsolatedWorld(
      LIVE_REGION_WORLD_ID,
      [{ code: liveRegionPageScript(effectiveAction, effectiveAction === 'start' ? selector : undefined) }],
      false
    ) as LiveRegionPageResult
    if (tab.observationGeneration !== observationGeneration) {
      throw new Error('Workspace control changed while reading the live region')
    }
    if (!this.host.isCurrent(tab)
      || tab.webContents !== webContents
      || webContents.isDestroyed()
      || tab.navigationGeneration !== navigationGeneration) {
      throw new Error('The page changed while reading the live region. Start a fresh recording.')
    }
    if (requests.action !== recordingAction || request < requests.applied) {
      throw new Error('The recording changed while reading the live region. Try again.')
    }
    requests.applied = request
    if ('error' in result) {
      // A rejected start has already cleared the previous recording in the page.
      tab.liveRegionRecording = undefined
      throw new Error(LIVE_REGION_ERRORS[result.error] ?? 'The live region could not be recorded')
    }
    tab.liveRegionRecording = result.startedAt
      ? { active: result.active, startedAt: result.startedAt, observationGeneration }
      : undefined
    return {
      tabId: tab.id,
      title: tab.title,
      url: redactNetworkUrl(tab.url),
      ...result,
      limits: {
        maxObservations: LIVE_REGION_LIMITS.maxObservations,
        maxObservationChars: LIVE_REGION_LIMITS.maxObservationChars,
        maxTotalChars: LIVE_REGION_LIMITS.maxTotalChars,
        maxNodesPerRead: LIVE_REGION_LIMITS.maxNodesPerRead,
        maxCallbacks: LIVE_REGION_LIMITS.maxCallbacks,
        maxDurationMs: LIVE_REGION_LIMITS.maxDurationMs
      },
      caveats: [...LIVE_REGION_CAVEATS]
    }
  }

  /**
   * Drop retained page text when the agent is paused or workspace authority changes, without waiting for the next tool call.
   * A start still in flight is cleared too: its clear script is queued behind it in the same world.
   */
  release(tab: T): void {
    const requests = this.requests.get(tab)
    if (!tab.liveRegionRecording && !requests) return
    tab.liveRegionRecording = undefined
    if (requests) requests.action = Symbol('release')
    const webContents = tab.webContents
    if (webContents.isDestroyed()) return
    void webContents.executeJavaScriptInIsolatedWorld(
      LIVE_REGION_WORLD_ID,
      [{ code: liveRegionPageScript('clear') }],
      false
    ).catch(() => undefined)
  }
}
