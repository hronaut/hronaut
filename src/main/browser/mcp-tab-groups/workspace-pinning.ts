import type { BrowserState } from '../../../shared/types.js'
import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'
import { browserState, publishChange } from '../browser-state/browser-state.js'

/**
 * Pins a workspace to the top of the tab rail, after those pinned before it, or unpins it. Only the person does this,
 * from the workspace's menu; it changes neither when the workspace was last used nor what agents may do in it.
 */
export function setWorkspacePinned(browser: Browser, groupId: string, pinned: boolean): BrowserState {
  const group = browser.mcpTabGroups.get(groupId)
  if (!group) throw new LocalizedError('appErrors.workspace.unavailable', undefined, { message: `Unknown workspace: ${groupId}` })
  if (pinned === (group.pinnedAt !== undefined)) return browserState(browser)
  if (pinned) {
    // After every earlier pin even if the clock went back since, so a new pin always goes last.
    const latest = Math.max(0, ...[...browser.mcpTabGroups.values()].map((candidate) => candidate.pinnedAt ? Date.parse(candidate.pinnedAt) || 0 : 0))
    group.pinnedAt = new Date(Math.max(Date.now(), latest + 1)).toISOString()
  } else {
    delete group.pinnedAt
  }
  publishChange(browser)
  return browserState(browser)
}
