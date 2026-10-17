import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletRequestIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletRequestStatus(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_request_status',
    {
      description: toolDescription('wallet_request_status'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema, requestId: walletRequestIdSchema }
    },
    tabTool('wallet_request_status', async ({ workspaceId, tabId, walletSessionId, requestId }: {
      workspaceId: string; tabId: string; walletSessionId: string; requestId: string
    }) => textResult(await requireWallets().requestStatus(walletTarget(walletSessionId, workspaceId, tabId), requestId))),
    { leaseExempt: () => true }
  )
}
