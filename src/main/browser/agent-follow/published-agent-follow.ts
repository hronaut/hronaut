import type { Browser } from '../browser.js'

/** What the shell shows of following: only while the tab it showed is still the one in view. */
export function publishedAgentFollow(browser: Browser): { tabId: string; agentName: string } | undefined {
  const follow = browser.agentFollow
  if (
    !follow
    || !browser.followAgentActivity
    || follow.tabId !== browser.activeTabId
    // A tab the person picked, even the same one again, is not being followed.
    || follow.selectionGeneration !== browser.tabSelectionGeneration
    || !browser.tabs.has(follow.tabId)
  ) return undefined
  return { tabId: follow.tabId, agentName: follow.agentName }
}
