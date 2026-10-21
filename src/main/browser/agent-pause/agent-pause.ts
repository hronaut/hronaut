import type { BrowserState } from '../../../shared/types.js'
import { retireNetworkPriorityObservations } from '../network-recording.js'
import { handBackNote, type TakeOverMark } from '../take-over.js'
import { isHronautHomeUrl } from '../url.js'
import type { AgentPauseAccess, AgentPauseTab } from './agent-pause-access.js'

/**
 * Pauses or resumes every agent, and whether a tab may still be resumed on its
 * own while all are paused. Pausing releases each tab's live region recording,
 * CSS state preview, virtual passkey and logpoints; a tab the person took over
 * is handed back once it is no longer paused.
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
      access.stopVirtualPasskey(tab, 'authority-changed')
      access.stopLogpoints(tab, 'authority-changed')
    }
  }
  for (const tab of access.tabs()) settleTakeOver(access, tab)
  access.changed(false)
}

/**
 * Pauses or resumes the agent in a page tab, as an exception to a global
 * pause when there is one, and in every tab linked to it by a window one of
 * their pages opened, since those pages can reach each other's. A paused
 * tab's live region recording, CSS state preview, virtual passkey and
 * logpoints are released, and a take over marks the tab as the person's
 * until it is resumed and handed back.
 */
export function setTabAgentPaused<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tabId: string, paused: boolean, options: { takeOver?: boolean } = {}): BrowserState {
  const tab = access.getTab(tabId)
  tab.nativeInputEnvironmentGeneration += 1
  if (isHronautHomeUrl(tab.url)) throw new Error('Agent control is only available for page tabs.')
  if (access.allAgentsPaused() && !access.agentPauseOverridesAllowed()) throw new Error('Agents are temporarily paused for a protected operation.')
  for (const linked of windowLinkedTabs(access, tab)) {
    if (linked !== tab) linked.nativeInputEnvironmentGeneration += 1
    applyTabAgentPause(access, linked, paused, linked === tab && options.takeOver === true)
  }
  access.changed()
  return access.getState()
}

/** Pauses or resumes the agent in one tab, as setTabAgentPaused does for each linked tab. */
function applyTabAgentPause<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tab: Tab, paused: boolean, takeOver: boolean): void {
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
    access.stopVirtualPasskey(tab, 'authority-changed')
    access.stopLogpoints(tab, 'authority-changed')
    if (takeOver && !tab.takeOver) {
      tab.takeOver = takeOverMark(tab)
      tab.handedBack = undefined
    }
  }
  settleTakeOver(access, tab)
}

/**
 * The tab and every open tab linked to it through windows their pages
 * opened, directly or through other linked tabs: a website popup and the tab
 * that opened it can reach each other's pages, and so can a popup's popup.
 */
export function windowLinkedTabs<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tab: Tab): Tab[] {
  const tabs = [...access.tabs()]
  const linked = [tab]
  for (let index = 0; index < linked.length; index += 1) {
    const current = linked[index]!
    for (const other of tabs) {
      if (!linked.includes(other) && (other.openerTabId === current.id || current.openerTabId === other.id)) linked.push(other)
    }
  }
  return linked
}

/**
 * Gives a tab just opened for a window its opener's pause, including an
 * exception to a global pause, since the two pages can reach each other's.
 */
export function shareWindowOpenerPause<Tab extends AgentPauseTab>(access: AgentPauseAccess<Tab>, tab: Tab): void {
  const opener = tab.openerTabId ? access.findTab(tab.openerTabId) : undefined
  if (!opener) return
  if (opener.tabAgentPaused) tab.tabAgentPaused = true
  if (access.globallyResumedAgentTabIds().has(opener.id)) access.globallyResumedAgentTabIds().add(tab.id)
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
