import { z } from 'zod'
import { COMPUTED_ACCESSIBILITY_LIMITS } from '../../../../shared/computed-accessibility.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

function computedAccessibilitySettlement() {
  // Each re-check names this tab, so a capability profile's origins apply to the page the element belongs to.
  return { authorizesResolvedTab: true }
}

export function registerBrowserComputedAccessibility(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_computed_accessibility',
    {
      description: toolDescription('browser_computed_accessibility'),
      inputSchema: {
        tabId: tabIdSchema,
        ref: z.string().min(1).max(COMPUTED_ACCESSIBILITY_LIMITS.maxRefChars).optional()
          .describe('A ref from this tab\'s latest snapshot'),
        selector: z.string().min(1).max(COMPUTED_ACCESSIBILITY_LIMITS.maxSelectorChars).optional()
          .describe('A CSS selector that matches exactly one element of the top-level document')
      }
    },
    tabTool('browser_computed_accessibility', async ({ tabId, ref, selector }: {
      tabId: string
      ref?: string
      selector?: string
    }, call: WorkspaceToolCall<ReturnType<typeof computedAccessibilitySettlement>>) =>
      textResult(await manager.computedAccessibility(tabId, { ref, selector }, { assertCurrent: () => call.requireCurrentTarget() }))),
    { settlement: computedAccessibilitySettlement }
  )
}
