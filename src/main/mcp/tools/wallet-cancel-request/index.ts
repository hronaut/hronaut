import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletRequestIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletCancelRequest(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_cancel_request',
    {
      description: toolDescription('wallet_cancel_request'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema, requestId: walletRequestIdSchema }
    },
    tabTool('wallet_cancel_request', async ({ workspaceId, tabId, walletSessionId, requestId }: {
      workspaceId: string; tabId: string; walletSessionId: string; requestId: string
    }) => textResult(await requireWallets().cancelRequest(walletTarget(walletSessionId, workspaceId, tabId), requestId)))
  )
}
