import { z } from 'zod'
import type { UserAttentionInput } from '../../../../shared/types.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserRequestUserAttention(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, requestUserAttention, tabTool } = context
  registerWorkspaceTool(
    'browser_request_user_attention',
    {
      description: toolDescription('browser_request_user_attention'),
      inputSchema: {
        reason: z.string().trim().min(1).max(280).describe('What the user needs to do, without secrets or credentials.'),
        notificationMessage: z.string().trim().min(1).max(200).optional().describe('Short, secret-free text for the system notification. Defaults to reason.'),
        tabId: tabIdSchema.optional().describe('The browser tab that needs the user, when applicable.')
      }
    },
    tabTool('browser_request_user_attention', async ({ reason, notificationMessage, workspaceId, tabId }: UserAttentionInput) => {
      if (tabId && !manager.getState().tabs.some((tab) => tab.id === tabId)) {
        throw new Error(`Unknown tab: ${tabId}`)
      }
      return textResult(await requestUserAttention({ reason, notificationMessage, workspaceId, tabId }))
    }),
    { tabTarget: 'optional', continuityInspection: () => true, pageOrigins: 'none' }
  )
}
