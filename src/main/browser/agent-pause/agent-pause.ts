import type { BrowserState } from '../../../shared/types.js'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import { handBackNote, type TakeOverMark } from '../take-over.js'
import { isHronautHomeUrl } from '../url.js'
import type { AgentPauseAccess, AgentPauseTab } from './agent-pause-access.js'

/**
 * Pauses or resumes every agent, and whether a tab may still be resumed on its
 * own while all are paused. Pausing releases each tab's live region recording
 * and CSS state preview; a tab the person took over is handed back once it is
 * no longer paused.
 */
export function setAllAgentsPaused<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, paused: boolean, allowTabOverrides = true): void {
  for (const tab of access.tabs()) tab.nativeInputEnvironmentGeneration += 1
  if (access.allAgentsPaused() !== paused || access.agentPauseOverridesAllowed() !== allowTabOverrides
    || access.globallyResumedAgentTabIds().size > 0) {
    for (const tab of access.tabs()) retireNetworkPriorityObservations(tab)
  }
  access.writeAllAgentsPaused(paused)
  access.writeAgentPauseOverridesAllowed(allowTabOverrides)
  access.globallyResumedAgentTabIds().clear()
  if (paused) {
    for (const tab of access.tabs()) {
      access.releaseLiveRegion(tab)
      void access.clearCssStatePreview(tab, 'agent-paused').catch(() => undefined)
    }
  }
  for (const tab of access.tabs()) settleTakeOver(access, tab)
  access.changed(false)
}

/**
 * Pauses or resumes the agent in a page tab, as an exception to a global
 * pause when there is one. A paused tab's live region recording and CSS state
 * preview are released, and a take over marks the tab as the person's until
 * it is resumed and handed back.
 */
export function setTabAgentPaused<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
  const tab = access.getTab(tabId)
  tab.nativeInputEnvironmentGeneration += 1
  if (isHronautHomeUrl(tab.url)) throw new Error('Agent control is only available for page tabs.')
  if (access.allAgentsPaused() && !access.agentPauseOverridesAllowed()) throw new Error('Agents are temporarily paused for a protected operation.')
  if (isTabAgentPaused(access, tab.id) !== paused) retireNetworkPriorityObservations(tab)
  if (access.allAgentsPaused()) {
    if (paused) access.globallyResumedAgentTabIds().delete(tab.id)
    else access.globallyResumedAgentTabIds().add(tab.id)
  } else {
    tab.tabAgentPaused = paused
  }
  // A person taking over the tab may reveal text the agent should not read back later.
  if (isTabAgentPaused(access, tab.id)) {
    access.releaseLiveRegion(tab)
    void access.clearCssStatePreview(tab, 'agent-paused').catch(() => undefined)
    if (options.takeOver && !tab.takeOver) {
      tab.takeOver = takeOverMark(tab)
      tab.handedBack = undefined
    }
  }
  settleTakeOver(access, tab)
  access.changed()
  return access.getState()
}

/** Any resume of a tab the person took over hands it back, and tells its agent what changed. */
function settleTakeOver<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tab: Tab): void {
  if (!tab.takeOver || isTabAgentPaused(access, tab.id)) return
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
function takeOverMark(tab: AgentPauseTab): TakeOverMark {
  return {
    at: Date.now(),
    url: tab.url,
    navigationGeneration: tab.navigationGeneration,
    humanInteractionGeneration: tab.humanInteractionGeneration
  }
}

/** The person took this tab over from its agent and has not handed it back. */
export function isTabTakenOver<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tabId: string): boolean {
  return Boolean(access.findTab(tabId)?.takeOver) && isTabAgentPaused(access, tabId)
}

/** Whether the agent may not act in the tab now; an unknown or closed tab counts as paused. */
export function isTabAgentPaused<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tabId: string): boolean {
  const tab = access.findTab(tabId)
  if (!tab) return true
  return access.allAgentsPaused()
    ? !access.agentPauseOverridesAllowed() || !access.globallyResumedAgentTabIds().has(tabId)
    : tab.tabAgentPaused
}

/** Whether any tab is resumed as an exception to a global pause. */
export function hasAgentPauseExceptions<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>): boolean {
  return access.allAgentsPaused() && access.agentPauseOverridesAllowed() && access.globallyResumedAgentTabIds().size > 0
}
