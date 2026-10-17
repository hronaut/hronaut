import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserUserAttention(context: McpToolContext): void {
  const { registerTool, requireActiveCapabilityDispatch, requireAgentWorkspace, tool, userAttentionLifecycle } = context
  registerTool(
    'browser_user_attention',
    {
      description: toolDescription('browser_user_attention'),
      inputSchema: {
        workspaceId: workspaceIdSchema,
        requestId: z.uuid().describe('Exact id returned by browser_request_user_attention.'),
        action: z.enum(['status', 'wait']).default('status'),
        timeoutMs: z.number().int().min(1).max(60_000).default(30_000)
      }
    },
    tool(async (input: { workspaceId: string; requestId: string; action: 'status' | 'wait'; timeoutMs: number }, extra) => {
      const authorize = (): void => {
        requireAgentWorkspace(input.workspaceId)
        requireActiveCapabilityDispatch('browser_user_attention', input)
      }
      authorize()
      if (!userAttentionLifecycle) throw new Error('Attention history unavailable')
      return textResult(input.action === 'wait'
        ? await userAttentionLifecycle.wait(input.requestId, input.workspaceId, input.timeoutMs, authorize, extra?.signal)
        : userAttentionLifecycle.status(input.requestId, input.workspaceId))
    })
  )
}
