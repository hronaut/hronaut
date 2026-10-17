import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type SelectionSettlement, selectionSettlement } from './selection-settlement.js'

export function registerBrowserSelect(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_select',
    {
      description: toolDescription('browser_select'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        value: z.string().optional(),
        values: z.array(z.string().max(1024)).max(50).optional()
          .describe('Semantic select[multiple] replacement by exact values; empty clears. No keyboard or pointer gestures.')
      }
    },
    tabTool('browser_select', async (input: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, call: WorkspaceToolCall<SelectionSettlement | undefined>) => {
      // Only a multi-value selection is guarded and tracked by submission.
      const multiple = call.settlement
      const retainSelection = multiple?.retainAuthority
      const markSelectionSubmitted = multiple?.markSubmitted
      const validateSelect = multiple ? (validateContext: () => void): void => {
        if (call.signal?.aborted) throw new Error('Selection cancelled')
        call.requireCurrentTarget()
        call.requirePostWriteContext()
        validateContext()
        if (call.authorityRejection()) throw new Error('Selection authority changed')
      } : undefined
      const result = await manager.select(input, validateSelect, retainSelection, markSelectionSubmitted)
      if (input.values === undefined) return textResult(result)
      const outcome = result as Record<string, unknown>
      return { ...textResult(outcome), structuredContent: outcome, ...(outcome.ok === false ? { isError: true } : {}) }
    }),
    { settlement: input => input.values !== undefined ? selectionSettlement() : undefined }
  )
}
