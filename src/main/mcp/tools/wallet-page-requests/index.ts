import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletPageRequests(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_page_requests',
    {
      description: toolDescription('wallet_page_requests'),
      inputSchema: { tabId: tabIdSchema.optional(), walletSessionId: walletSessionIdSchema }
    },
    tabTool('wallet_page_requests', async ({ workspaceId, tabId, walletSessionId }: {
      workspaceId: string; tabId: string; walletSessionId: string
    }) => {
      const target = walletTarget(walletSessionId, workspaceId, tabId)
      const operations = requireWallets()
      if (!operations.pageRequests) throw new Error('Wallet page requests are unavailable')
      return textResult(await operations.pageRequests(target))
    })
  )
}
