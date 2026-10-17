import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletBalance(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_balance',
    {
      description: toolDescription('wallet_balance'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        walletSessionId: walletSessionIdSchema,
        walletId: walletIdSchema,
        token: z.string().min(1).max(64).regex(/^[A-Za-z0-9]+$/).optional()
          .describe('Optional fungible token to read instead of the native balance: an ERC-20 contract address on EVM, an SPL token mint on Solana, or a TRC-20 contract address on TRON.'),
        spender: z.string().min(1).max(64).regex(/^[A-Za-z0-9]+$/).optional()
          .describe('Optional, with token on EVM or TRON: also read how much of the token this spender address may still move from the wallet, such as a DEX router after an approval.')
      }
    },
    tabTool('wallet_balance', async ({ workspaceId, tabId, walletSessionId, walletId, token, spender }: {
      workspaceId: string; tabId: string; walletSessionId: string; walletId: string; token?: string; spender?: string
    }) => textResult(await requireWallets().balance(walletTarget(walletSessionId, workspaceId, tabId), walletId, token, spender)))
  )
}
