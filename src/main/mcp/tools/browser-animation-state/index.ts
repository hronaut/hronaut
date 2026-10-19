import { z } from 'zod'
import { ANIMATION_STATE_LIMITS } from '../../../../shared/animation-state.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { type ElementInspectionSettlement, elementInspectionSettlement } from '../element-inspection-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserAnimationState(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_animation_state',
    {
      description: toolDescription('browser_animation_state'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.never().optional().describe('Snapshot refs are unsupported; use a unique selector. Ref input is rejected even when selector is also supplied.'),
        selector: z.string().min(1).max(ANIMATION_STATE_LIMITS.maxSelectorChars).describe('Select one unique current element in the top-level light DOM. Only animations directly on it are read, not its descendants\' or pseudo-elements\'.')
      }
    },
    tabTool('browser_animation_state', async (options: { tabId?: string; ref?: never; selector: string }, call: WorkspaceToolCall<ElementInspectionSettlement>) =>
      textResult(await manager.animationState(options, call.requireCurrentTarget, pending => { call.settlement.retain(pending) }))),
    { settlement: () => elementInspectionSettlement(false), preservesPresentation: () => true }
  )
}
