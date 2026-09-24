import type { WebContents } from 'electron'
import type { BrowserDomChangesAction, BrowserDomChangesReport } from '../../shared/types.js'
import { domChangesPageScript } from '../../shared/dom-changes.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isHronautHomeUrl } from './url.js'

const DOM_CHANGES_WORLD_ID = 1005

export interface BrowserDomRecordingState {
  active: boolean
  changeCount: number
  startedAt: string
  observationGeneration: number
}

interface DomRecordingTab {
  id: string
  title: string
  url: string
  navigationGeneration: number
  observationGeneration: number
  webContents: WebContents
  domChangesRecording?: BrowserDomRecordingState
}

interface DomRecorderHost<T> {
  isCurrent(tab: T): boolean
  changed(): void
}

/** Keep page execution and stale-response ownership in the same boundary. */
export class BrowserDomRecorder<T extends DomRecordingTab> {
  private readonly domRecordingRequests = new WeakMap<T, { action?: symbol; requested: number; applied: number }>()

  constructor(private readonly host: DomRecorderHost<T>) {}

  async manage(tab: T, action: BrowserDomChangesAction): Promise<BrowserDomChangesReport> {
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording DOM changes')
    if (!['start', 'get', 'stop', 'clear'].includes(action)) throw new Error('Unsupported DOM changes action')

    const observationGeneration = tab.observationGeneration
    const navigationGeneration = tab.navigationGeneration
    const webContents = tab.webContents
    const effectiveAction = tab.domChangesRecording
      && tab.domChangesRecording.observationGeneration !== observationGeneration
      && action !== 'start'
      ? 'clear'
      : action
    const requests = this.domRecordingRequests.get(tab) ?? { requested: 0, applied: 0 }
    this.domRecordingRequests.set(tab, requests)
    if (effectiveAction !== 'get') requests.action = Symbol(effectiveAction)
    const recordingAction = requests.action
    const request = ++requests.requested
    const result = await webContents.executeJavaScriptInIsolatedWorld(
      DOM_CHANGES_WORLD_ID,
      [{ code: domChangesPageScript(effectiveAction) }],
      false
    ) as Omit<BrowserDomChangesReport, 'tabId' | 'title' | 'url' | 'caveats'>
    if (tab.observationGeneration !== observationGeneration) {
      throw new Error('Workspace control changed while reading DOM changes')
    }
    if (!this.host.isCurrent(tab)
      || tab.webContents !== webContents
      || webContents.isDestroyed()
      || tab.navigationGeneration !== navigationGeneration) {
      throw new Error('The page changed while reading DOM changes. Start a fresh recording.')
    }
    if (requests.action !== recordingAction || request < requests.applied) {
      throw new Error('The recording changed while reading DOM changes. Try again.')
    }
    requests.applied = request
    if (result.startedAt) {
      tab.domChangesRecording = {
        active: result.active,
        changeCount: result.changeCount,
        startedAt: result.startedAt,
        observationGeneration
      }
    } else {
      tab.domChangesRecording = undefined
    }
    this.host.changed()
    return {
      tabId: tab.id,
      title: tab.title,
      url: redactNetworkUrl(tab.url),
      ...result,
      caveats: [
        'Only structural selectors, mutation types, attribute names, tag names, and counts are recorded.',
        'Page text, HTML, attribute values, IDs, classes, form values, clipboard content, and file paths are never recorded.',
        'Cross-origin frames and changes inside existing shadow roots are not observed.',
        'A full document navigation clears the recording because it creates a new DOM.'
      ]
    }
  }

}
