import { WalletPublicRequestPayloadSchema } from '../../../../shared/wallet.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletPrepareTransaction(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_prepare_transaction',
    {
      description: toolDescription('wallet_prepare_transaction'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        walletSessionId: walletSessionIdSchema,
        walletId: walletIdSchema,
        transaction: WalletPublicRequestPayloadSchema.describe('Chain-specific unsigned transaction. Secret-bearing fields are rejected.')
      }
    },
    tabTool('wallet_prepare_transaction', async ({ workspaceId, tabId, walletSessionId, walletId, transaction }: {
      workspaceId: string; tabId: string; walletSessionId: string; walletId: string; transaction: unknown
    }) => textResult(await requireWallets().prepareTransaction(
      walletTarget(walletSessionId, workspaceId, tabId), walletId, transaction
    )))
  )
}
