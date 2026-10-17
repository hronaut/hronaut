/** How many workspaces the vertical tab rail lists before it folds the rest into its "All N workspaces" row. */
export const RAIL_WORKSPACE_LIMIT = 10

export interface FoldedRailWorkspaces<T> {
  /** The workspaces the rail lists, in their order. */
  listed: T[]
  /** The workspaces only the switcher lists. */
  folded: T[]
}

/**
 * Past the limit, the rail lists the first workspaces in their order and folds the rest away, except those in `keep`
 * (the workspace in view, one that needs you), which keep their place in the order. Folding a single workspace would
 * only swap it for the row, so then the rail lists them all.
 */
export function foldRailWorkspaces<T extends { id: string }>(
  workspaces: readonly T[],
  keep: ReadonlySet<string>,
  limit = RAIL_WORKSPACE_LIMIT
): FoldedRailWorkspaces<T> {
  const listed: T[] = []
  const folded: T[] = []
  workspaces.forEach((workspace, index) => {
    if (index < limit || keep.has(workspace.id)) listed.push(workspace)
    else folded.push(workspace)
  })
  return folded.length > 1 ? { listed, folded } : { listed: [...workspaces], folded: [] }
}

function pinnedTime(pinnedAt: string): number {
  const time = Date.parse(pinnedAt)
  return Number.isFinite(time) ? time : 0
}

/** Pinned workspaces first, the earliest pinned first, then the rest in their order. */
export function pinnedWorkspacesFirst<T extends { pinnedAt?: string }>(workspaces: readonly T[]): T[] {
  const pinned = workspaces.filter((workspace) => workspace.pinnedAt !== undefined)
    .sort((left, right) => pinnedTime(left.pinnedAt!) - pinnedTime(right.pinnedAt!))
  return [...pinned, ...workspaces.filter((workspace) => workspace.pinnedAt === undefined)]
}
