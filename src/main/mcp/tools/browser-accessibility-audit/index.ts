import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserAccessibilityAudit(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_accessibility_audit',
    {
      description: toolDescription('browser_accessibility_audit'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['measure', 'set-baseline', 'clear-baseline']).optional()
          .describe('Measure now, save this audit as the volatile tab baseline, or clear the baseline.'),
        selector: z.string().min(1).max(1_024).optional(),
        standard: z.enum(['wcag-aa', 'wcag-aaa', 'best-practice', 'all']).optional(),
        maxViolations: z.number().int().min(1).max(50).optional(),
        maxNodesPerViolation: z.number().int().min(1).max(10).optional()
      }
    },
    tabTool('browser_accessibility_audit', async ({
      tabId,
      action,
      selector,
      standard,
      maxViolations,
      maxNodesPerViolation
    }: {
      tabId?: string
      action?: 'measure' | 'set-baseline' | 'clear-baseline'
      selector?: string
      standard?: 'wcag-aa' | 'wcag-aaa' | 'best-practice' | 'all'
      maxViolations?: number
      maxNodesPerViolation?: number
    }) => textResult(await manager.accessibilityAudit({
      tabId,
      action,
      selector,
      standard,
      maxViolations,
      maxNodesPerViolation
    })))
  )
}
