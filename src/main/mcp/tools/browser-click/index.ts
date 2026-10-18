import { agentCursorIdentity } from '../../agent-presence.js'
import { browserClickSchema } from '../../browser-click-input.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { PostWriteRequest, PreWriteReconciliationRequest } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type ClickSettlement, clickSettlement } from './click-settlement.js'
import { browserClickInputShape } from './input-shape.js'

export function browserClickPageInput<T extends object>(input: T & { postcondition?: unknown; reconciliation?: unknown }): Omit<T, 'postcondition' | 'reconciliation'> {
  const { postcondition: _postcondition, reconciliation: _reconciliation, ...pageInput } = input
  return pageInput
}

export function registerBrowserClick(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_click',
    {
      description: toolDescription('browser_click'),
      inputSchema: browserClickInputShape
    },
    tabTool('browser_click', async (input: {
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
      doubleClick?: boolean
      native?: boolean
      button?: 'left' | 'right'
      modifiers?: Array<'Shift' | 'Control' | 'Meta' | 'ControlOrMeta'>
      dialogAction?: 'accept' | 'dismiss'
      promptText?: string
      postcondition?: PostWriteRequest
      reconciliation?: PreWriteReconciliationRequest
    }, call: WorkspaceToolCall<ClickSettlement>) => {
      // Re-checks the call before each native input event.
      const validateNativeInput = (validateContext: () => void): void => {
        try {
          if (call.signal?.aborted) throw new Error('Native input cancelled; earlier input effects are not rolled back')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          validateContext()
          if (call.authorityRejection()) throw new Error('Native input authority changed; inspect fresh state before continuing. Earlier input effects are not rolled back')
        } catch (error) {
          // Preparation or an earlier click in a double-click may
          // already have effects. Never classify this as safe replay.
          call.rememberInputPolicy(error)
          call.setInvalidatedOutcome('outcome-unknown')
          throw error
        }
      }
      return textResult(await manager.click(browserClickPageInput(input), validateNativeInput, call.settlement.recordProgress, call.settlement.retainAuthority, agentCursorIdentity(client.name)))
    }),
    {
      settlement: input => clickSettlement(manager, input.button === 'right'),
      preservesPresentation: input => input.button === 'right',
      postcondition: input => input.postcondition ? input.postcondition as PostWriteRequest : undefined,
      reconciliation: input => input.reconciliation ? input.reconciliation as PreWriteReconciliationRequest : undefined,
      inputSchema: browserClickSchema,
      stepTarget: input => ({ ref: input.ref })
    }
  )
}
