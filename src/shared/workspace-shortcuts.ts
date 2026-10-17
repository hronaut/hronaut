import { pinnedWorkspacesFirst } from './workspace-rail.js'

/** Pressing the workspace key again within this time goes one workspace further back, instead of back and forth. */
export const WORKSPACE_CYCLE_MS = 1_500

/** The workspace a pinned-workspace key goes to: the nth pinned one, in the rail's order; none past the last. */
export function pinnedWorkspaceAt<T extends { pinnedAt?: string }>(workspaces: readonly T[], position: number): T | undefined {
  return position >= 1 ? pinnedWorkspacesFirst(workspaces).filter((workspace) => workspace.pinnedAt !== undefined)[position - 1] : undefined
}

function usedAt(value: string): number {
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : 0
}

/** The open workspaces other than the current one, the one used most recently first. */
export function recentWorkspaces<T extends { id: string; lastUsedAt: string }>(workspaces: readonly T[], currentId: string | undefined): T[] {
  return workspaces.filter((workspace) => workspace.id !== currentId).sort((left, right) => usedAt(right.lastUsedAt) - usedAt(left.lastUsedAt))
}
