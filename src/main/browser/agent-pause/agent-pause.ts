import type { BrowserState } from '../../../shared/types.js'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import { handBackNote, type TakeOverMark } from '../take-over.js'
import { isHronautHomeUrl } from '../url.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/**
 * Pauses or resumes every agent, and whether a tab may still be resumed on its
 * own while all are paused. Pausing releases each tab's live region recording,
 * CSS state preview, virtual passkey and logpoints; a tab the person took over
 * is handed back once it is no longer paused.
 */
export function setAllAgentsPaused(browser: Browser, paused: boolean, allowTabOverrides = true): void {
  for (const tab of browser.tabs.values()) tab.nativeInputEnvironmentGeneration += 1
  if (browser.allAgentsPaused !== paused || browser.agentPauseOverridesAllowed !== allowTabOverrides
    || browser.globallyResumedAgentTabIds.size > 0) {
    for (const tab of browser.tabs.values()) retireNetworkPriorityObservations(tab)
  }
  browser.allAgentsPaused = paused
  browser.agentPauseOverridesAllowed = allowTabOverrides
  browser.globallyResumedAgentTabIds.clear()
  if (paused) {
    for (const tab of browser.tabs.values()) {
      browser.liveRegionRecorder.release(tab)
      void browser.cssStatePreview.clear(tab, 'agent-paused').catch(() => undefined)
      browser.virtualPasskeys.stop(tab, 'authority-changed')
      browser.logpoints.stop(tab, 'authority-changed')
    }
  }
  for (const tab of browser.tabs.values()) settleTakeOver(browser, tab)
  publishChange(browser, false)
}

/**
 * Pauses or resumes the agent in a page tab, as an exception to a global
 * pause when there is one. A paused tab's live region recording, CSS state
 * preview, virtual passkey and logpoints are released, and a take over marks
 * the tab as the person's until it is resumed and handed back.
 */
export function setTabAgentPaused(browser: Browser, tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
  const tab = getTab(browser, tabId)
  tab.nativeInputEnvironmentGeneration += 1
  if (isHronautHomeUrl(tab.url)) throw new Error('Agent control is only available for page tabs.')
  if (browser.allAgentsPaused && !browser.agentPauseOverridesAllowed) throw new Error('Agents are temporarily paused for a protected operation.')
  if (isTabAgentPaused(browser, tab.id) !== paused) retireNetworkPriorityObservations(tab)
  if (browser.allAgentsPaused) {
    if (paused) browser.globallyResumedAgentTabIds.delete(tab.id)
    else browser.globallyResumedAgentTabIds.add(tab.id)
  } else {
    tab.tabAgentPaused = paused
  }
  // A person taking over the tab may reveal text the agent should not read back later.
  if (isTabAgentPaused(browser, tab.id)) {
    browser.liveRegionRecorder.release(tab)
    void browser.cssStatePreview.clear(tab, 'agent-paused').catch(() => undefined)
    browser.virtualPasskeys.stop(tab, 'authority-changed')
    browser.logpoints.stop(tab, 'authority-changed')
    if (options.takeOver && !tab.takeOver) {
      tab.takeOver = takeOverMark(tab)
      tab.handedBack = undefined
    }
  }
  settleTakeOver(browser, tab)
  publishChange(browser)
  return browserState(browser)
}

/** Any resume of a tab the person took over hands it back, and tells its agent what changed. */
function settleTakeOver(browser: Browser, tab: BrowserTab): void {
  if (!tab.takeOver || isTabAgentPaused(browser, tab.id)) return
  const end = takeOverMark(tab)
  tab.handedBack = {
    at: Date.now(),
    note: handBackNote(tab.takeOver, end),
    // Agents read this one instead while the person keeps URL query strings and fragments from them.
    ...(end.url === tab.takeOver.url ? {} : { noteWithoutUrlDetail: handBackNote(tab.takeOver, end, true) })
  }
  tab.takeOver = undefined
}

/** The tab as it is now, for a take over and its hand back note. */
function takeOverMark(tab: BrowserTab): TakeOverMark {
  return {
    at: Date.now(),
    url: tab.url,
    navigationGeneration: tab.navigationGeneration,
    humanInteractionGeneration: tab.humanInteractionGeneration
  }
}

/** The person took this tab over from its agent and has not handed it back. */
export function isTabTakenOver(browser: Browser, tabId: string): boolean {
  return Boolean(findTab(browser, tabId)?.takeOver) && isTabAgentPaused(browser, tabId)
}

/** Whether the agent may not act in the tab now; an unknown or closed tab counts as paused. */
export function isTabAgentPaused(browser: Browser, tabId: string): boolean {
  const tab = findTab(browser, tabId)
  if (!tab) return true
  return browser.allAgentsPaused
    ? !browser.agentPauseOverridesAllowed || !browser.globallyResumedAgentTabIds.has(tabId)
    : tab.tabAgentPaused
}

/** Whether any tab is resumed as an exception to a global pause. */
export function hasAgentPauseExceptions(browser: Browser): boolean {
  return browser.allAgentsPaused && browser.agentPauseOverridesAllowed && browser.globallyResumedAgentTabIds.size > 0
}
