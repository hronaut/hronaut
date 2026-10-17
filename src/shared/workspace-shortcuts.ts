import { pinnedWorkspacesFirst } from './workspace-rail.js'

/** Pressing the workspace key again within this time goes one workspace further back, instead of back and forth. */
export const WORKSPACE_CYCLE_MS = 1_500

/** Pinned workspaces with a key, in the rail's order: the first nine not hidden from the rail. */
export function keyedPinnedWorkspaces<T extends { pinnedAt?: string; hiddenFromSidebar?: boolean }>(workspaces: readonly T[]): T[] {
  return pinnedWorkspacesFirst(workspaces).filter((workspace) => workspace.pinnedAt !== undefined && !workspace.hiddenFromSidebar).slice(0, 9)
}

/** The workspace a pinned-workspace key goes to: the nth keyed pinned one; none past the last. */
export function pinnedWorkspaceAt<T extends { pinnedAt?: string; hiddenFromSidebar?: boolean }>(workspaces: readonly T[], position: number): T | undefined {
  return position >= 1 ? keyedPinnedWorkspaces(workspaces)[position - 1] : undefined
}

function usedAt(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

/**
 * The open workspaces other than the current one: those the person viewed, the latest first, then the rest by their
 * last use, by the person or an agent.
 */
export function recentWorkspaces<T extends { id: string; lastUsedAt: string }>(
  workspaces: readonly T[],
  currentId: string | undefined,
  viewedIds: readonly string[] = []
): T[] {
  const viewed = (id: string): number => {
    const index = viewedIds.indexOf(id)
    return index < 0 ? viewedIds.length : index
  }
  return workspaces.filter((workspace) => workspace.id !== currentId)
    .sort((left, right) => viewed(left.id) - viewed(right.id) || usedAt(right.lastUsedAt) - usedAt(left.lastUsedAt))
}
