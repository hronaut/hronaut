import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'

interface ActionContext {
  workspaceId: string
  actionId: string
  active: boolean
}

const actionContext = new AsyncLocalStorage<ActionContext>()

/** Correlation only: this neither authorizes an action nor persists evidence. */
export async function withAuditAction<T>(
  workspaceId: string,
  operation: (actionId: string) => Promise<T>
): Promise<T> {
  const context: ActionContext = { workspaceId, actionId: randomUUID(), active: true }
  return actionContext.run(context, async () => {
    try {
      return await operation(context.actionId)
    } finally {
      // Detached callbacks retain their async context after the tool returns.
      // They cannot safely be attributed to a completed action.
      context.active = false
    }
  })
}

export function currentAuditAction(workspaceId: string): string | null {
  const context = actionContext.getStore()
  return context?.active && context.workspaceId === workspaceId ? context.actionId : null
}
