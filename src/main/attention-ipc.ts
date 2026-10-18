import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { McpHttpServer } from './mcp/server.js'
import type { TakeOverOffers } from './take-over-offers.js'
import type { UserAttentionLifecycle } from './user-attention-lifecycle.js'
import type { UserAttentionRequest } from '../shared/types.js'

interface AttentionIpcHost {
  /** Admits only the main window's shell document, not a detached panel window. */
  assertMainShellSender(event: IpcMainInvokeEvent): void
  /** The open request as the shell shows it, marked when it belongs to a human-waiting decision. */
  shellUserAttention(): UserAttentionRequest | null
  /** The attention request the shell shows now; read on every check because a newer request replaces it. */
  userAttention(): Pick<UserAttentionRequest, 'id' | 'tabId'> | null
  /** The human-waiting decision the current attention request stands for, if any. */
  attentionDecisionId(): string | undefined
  userAttentionLifecycle(): Pick<UserAttentionLifecycle, 'answer'>
  mcpServer(): Pick<McpHttpServer, 'recordAgentAnswer'> | null
  /** Ends the attention request the shell shows. */
  endUserAttention(options: { disposition?: 'acknowledged' | 'dismissed'; keepPending?: boolean }): void
  takeOvers(): Pick<TakeOverOffers, 'resolvedOn'>
}

/** Dependencies stay lazy because handlers are registered before the window loads. */
export function registerAttentionIpc(ipcMain: Pick<IpcMain, 'handle'>, host: AttentionIpcHost): void {
  ipcMain.handle('attention:get', (event) => {
    host.assertMainShellSender(event)
    return host.shellUserAttention()
  })
  ipcMain.handle('attention:answer', (event, id: unknown, answer: unknown) => {
    host.assertMainShellSender(event)
    if (typeof id !== 'string' || id.length > 128 || (answer !== 'resolved' && answer !== 'dismissed')) {
      throw new TypeError('Invalid attention answer')
    }
    // A card that was open for an earlier request answers nothing. A decision is answered as a decision.
    if (host.userAttention()?.id !== id || host.attentionDecisionId()) return false
    const tabId = host.userAttention()!.tabId
    host.userAttentionLifecycle().answer(id, answer)
    host.mcpServer()?.recordAgentAnswer(id, answer === 'dismissed' ? 'dismissed' : 'handedBack')
    host.endUserAttention({ disposition: answer === 'dismissed' ? 'dismissed' : 'acknowledged', keepPending: true })
    // Done, hand back on a tab the person took over also hands the tab back to its agents.
    if (answer === 'resolved') host.takeOvers().resolvedOn(tabId)
    return true
  })
}
