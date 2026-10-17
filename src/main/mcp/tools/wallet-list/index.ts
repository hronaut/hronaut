import { z } from 'zod'
import { WalletAgentDescriptorSchema } from '../../../../shared/wallet.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletList(context: McpToolContext): void {
  const { client, registerWorkspaceTool, requireWalletSessions, requireWallets, tabTool } = context
  registerWorkspaceTool(
    'wallet_list',
    {
      description: toolDescription('wallet_list'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        agentName: z.string().trim().min(1).max(128).optional().describe('Optional human-readable requesting agent name shown in trusted approvals.')
      }
    },
    tabTool('wallet_list', async ({ workspaceId, tabId, agentName }: {
      workspaceId: string; tabId: string; agentName?: string
    }) => {
      const session = requireWalletSessions().open(workspaceId, tabId, client, agentName)
      return textResult({
        walletSessionId: session.token,
        expiresAt: new Date(session.expiresAt).toISOString(),
        wallets: WalletAgentDescriptorSchema.array().parse(await requireWallets().list(session.target))
      })
    }),
    { leaseExempt: () => true }
  )
}
