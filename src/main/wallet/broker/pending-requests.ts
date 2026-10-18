import type { WalletRequestSummary } from '../../../shared/wallet.js'
import type { WalletMessageSigningInput } from '../accounts.js'
import { summary, trustedMessageDisplay, trustedMessageRaw } from '../request-summary.js'
import type { WalletService } from '../service.js'
import { typedDataDisplay } from '../typed-data-display.js'

/**
 * What the wallet prompt's request list needs from the broker, which keeps
 * the messages waiting to be signed, so the prompt shows the very bytes or
 * typed data a person would approve.
 */
export interface PendingRequestsAccess {
  service: Pick<WalletService, 'approvals' | 'list'>
  pendingMessages: ReadonlyMap<string, WalletMessageSigningInput>
}

/**
 * The wallet requests for the prompt, each with its wallet's summary and,
 * for a message still held, the message or typed data as it would be signed.
 */
export function listPending(access: PendingRequestsAccess): WalletRequestSummary[] {
  const wallets = new Map(access.service.list().map((wallet) => [wallet.id, wallet]))
  return access.service.approvals.list().map((record) => {
    const wallet = wallets.get(record.request.walletId)
    const result = summary(record, wallet)
    const pendingMessage = access.pendingMessages.get(record.id)
    if (result.details && pendingMessage && wallet) {
      result.details.raw = { ...result.details.raw, ...trustedMessageRaw(pendingMessage) }
      result.details.method = pendingMessage.kind === 'typed-data' ? 'typed-data-signing' : 'message-signing'
      const message = trustedMessageDisplay(pendingMessage, wallet, record.request.topLevelOrigin)
      if (message) {
        result.details.message = message
        // The whole text is on screen, so it is not an undecodable request.
        result.details.understood = !message.truncated && !message.warnings.includes('hidden-characters')
      }
      const typedData = pendingMessage.kind === 'typed-data' ? typedDataDisplay(pendingMessage.typedData, wallet) : undefined
      if (typedData) result.details.typedData = typedData
    }
    return result
  })
}
