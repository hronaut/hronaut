import { z } from 'zod'
import { CSS_STATE_PREVIEW_LIMITS, CSS_STATE_PREVIEW_STATES } from '../../../../shared/css-state-preview.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserCssStatePreview(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_css_state_preview',
    {
      description: toolDescription('browser_css_state_preview'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['set', 'get', 'clear']).default('get'),
        selector: z.string().min(1).max(CSS_STATE_PREVIEW_LIMITS.maxSelectorChars).optional()
          .describe('CSS selector for exactly one element in the top-level document; required for set'),
        states: z.array(z.enum(CSS_STATE_PREVIEW_STATES)).min(1).max(CSS_STATE_PREVIEW_STATES.length).optional()
          .describe('CSS states to force on that element; required for set'),
        durationMs: z.number().int().min(CSS_STATE_PREVIEW_LIMITS.minDurationMs).max(CSS_STATE_PREVIEW_LIMITS.maxDurationMs).optional()
          .describe(`How long the preview lasts before it clears itself; default ${CSS_STATE_PREVIEW_LIMITS.defaultDurationMs}`)
      }
    },
    tabTool('browser_css_state_preview', async ({
      tabId,
      action,
      ...options
    }: {
      tabId?: string
      action: 'set' | 'get' | 'clear'
      selector?: string
      states?: Array<'hover' | 'active'>
      durationMs?: number
    }) => textResult(await manager.cssStatePreviewAction(action, tabId, options)))
  )
}
