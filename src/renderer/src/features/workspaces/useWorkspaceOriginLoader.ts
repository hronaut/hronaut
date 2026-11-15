export type WorkspaceOriginLoadResult =
  | { status: 'ready'; origins: string[] }
  | { status: 'error'; error: unknown }
  | { status: 'stale' }

export function createWorkspaceOriginLoader(
  listOrigins: (workspaceId: string) => Promise<string[]>
): {
    load: (workspaceId: string) => Promise<WorkspaceOriginLoadResult>
    invalidate: () => void
  } {
  let generation = 0

  return {
    async load(workspaceId) {
      const requestGeneration = ++generation
      try {
        const origins = await listOrigins(workspaceId)
        return requestGeneration === generation
          ? { status: 'ready', origins }
          : { status: 'stale' }
      } catch (error) {
        return requestGeneration === generation
          ? { status: 'error', error }
          : { status: 'stale' }
      }
    },
    invalidate() {
      generation += 1
    }
  }
}
