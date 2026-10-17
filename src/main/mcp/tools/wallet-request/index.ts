import { z } from 'zod'
import { WalletPublicRequestPayloadSchema } from '../../../../shared/wallet.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema, walletIdSchema, walletSessionIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerWalletRequest(context: McpToolContext): void {
  const { registerWorkspaceTool, requireWallets, tabTool, walletTarget } = context
  registerWorkspaceTool(
    'wallet_request',
    {
      description: toolDescription('wallet_request'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        walletSessionId: walletSessionIdSchema,
        walletId: walletIdSchema,
        action: z.enum(['sign-transaction', 'sign-and-send', 'sign-message']),
        transaction: WalletPublicRequestPayloadSchema.optional().describe('Required for transaction actions. Secret-bearing fields are rejected.'),
        message: z.string().min(1).max(1_398_104).optional().describe('Required for sign-message. UTF-8 text by default, or canonical base64 when messageEncoding=base64.'),
        messageEncoding: z.enum(['utf8', 'base64']).default('utf8')
      }
    },
    tabTool('wallet_request', async ({ workspaceId, tabId, walletSessionId, walletId, action, transaction, message, messageEncoding }: {
      workspaceId: string
      tabId: string
      walletSessionId: string
      walletId: string
      action: 'sign-transaction' | 'sign-and-send' | 'sign-message'
      transaction?: unknown
      message?: string
      messageEncoding: 'utf8' | 'base64'
    }) => {
      const target = walletTarget(walletSessionId, workspaceId, tabId)
      if (action === 'sign-message') {
        if (!message) throw new TypeError('message is required for sign-message')
        const bytes = messageEncoding === 'base64' ? Buffer.from(message, 'base64') : Buffer.from(message, 'utf8')
        if (!bytes.length || bytes.length > 1_048_576 || (messageEncoding === 'base64' && bytes.toString('base64') !== message)) {
          bytes.fill(0)
          throw new TypeError('Wallet message is invalid')
        }
        try {
          return textResult(await requireWallets().requestMessage(target, walletId, Uint8Array.from(bytes)))
        } finally {
          bytes.fill(0)
        }
      }
      if (transaction === undefined) throw new TypeError('transaction is required for transaction requests')
      return textResult(await requireWallets().requestTransaction(target, walletId, transaction, action === 'sign-and-send'))
    })
  )
}
