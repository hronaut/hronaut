import { publishChange } from '../browser-state/browser-state.js'
import type { BrowserTab } from '../browser-tab.js'
import type { Browser } from '../browser.js'
import { BrowserReproRecorder } from './repro-recorder.js'
import { getTab } from '../browser-core.js'
import type { BrowserReproAction, BrowserReproRecording } from '../../../shared/types.js'

/** Records a person's steps in the browser's tabs as a repro, leaving out input an agent sent. */
export function createReproRecorder(browser: Browser): BrowserReproRecorder<BrowserTab> {
  return new BrowserReproRecorder<BrowserTab>({
    isCurrent: tab => browser.tabs.get(tab.id) === tab,
    isAgentInput: webContents => browser.agentInputWebContents.has(webContents.id),
    changed: () => publishChange(browser, false)
  })
}

/** Starts, reads, checkpoints, stops or clears the repro recording of a tab (the shown one when none is named). */
export async function reproRecording(browser: Browser, action: BrowserReproAction, tabId?: string, checkpoint?: unknown): Promise<BrowserReproRecording> {
  return browser.reproRecorder.manage(getTab(browser, tabId), action, checkpoint)
}
