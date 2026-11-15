import { LocalizedError } from '../../localized-error.js'
import type { Browser } from '../browser.js'

/** How many workspaces Hronaut keeps open at most. */
const MAX_ACTIVE_WORKSPACES = 50

/** Throws when Hronaut already keeps as many open workspaces as it can. */
export function assertActiveWorkspaceCapacity(browser: Browser): void {
  if (browser.mcpTabGroups.size >= MAX_ACTIVE_WORKSPACES) {
    throw new LocalizedError('appErrors.workspace.activeLimit', { max: MAX_ACTIVE_WORKSPACES })
  }
}

/** How many more open workspaces Hronaut can keep. */
export function openWorkspaceRoom(browser: Browser): number {
  return MAX_ACTIVE_WORKSPACES - browser.mcpTabGroups.size
}
