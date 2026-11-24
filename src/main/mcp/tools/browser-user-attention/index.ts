import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { workspaceIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { resolvedRequestPage } from './resolved-request-page.js'

export function registerBrowserUserAttention(context: McpToolContext): void {
  const { registerTool, requireActiveCapabilityDispatch, requireAgentWorkspace, tool, userAttentionLifecycle } = context
  // A request the person resolved comes with the page of its tab, so the agent goes on from what it shows now.
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
      const report = input.action === 'wait'
        ? await userAttentionLifecycle.wait(input.requestId, input.workspaceId, input.timeoutMs, authorize, extra?.signal)
        : userAttentionLifecycle.status(input.requestId, input.workspaceId)
      const request = 'request' in report ? report.request : report
      const result = textResult(report)
      if (request.state !== 'resolved' || !request.tabId) return result
      return { ...result, content: [...result.content, ...await resolvedRequestPage(context, input.workspaceId, request.tabId, authorize)] }
    }),
    { pageOrigins: 'none' }
  )
}
