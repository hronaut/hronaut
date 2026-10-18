import { z } from 'zod'
import { urlWithoutDetail } from '../../../../shared/url-detail.js'
import { textResult, toolDescription, urlDetailOmitted } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserWebmcp(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_webmcp',
    {
      description: toolDescription('browser_webmcp'),
      inputSchema: {
        action: z.enum(['status', 'list', 'call']).default('status'),
        tabId: tabIdSchema.optional(),
        expectedOrigin: z.string().url().max(2_048).optional()
          .describe('Exact HTTP(S) origin returned by action=list; required for call.'),
        navigationGeneration: z.number().int().min(0).optional()
          .describe('Exact navigation generation returned by action=list; required for call.'),
        descriptorDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional()
          .describe('Exact descriptor digest returned by action=list; required for call.'),
        toolName: z.string().min(1).max(128).optional()
          .describe('Exact page-provided tool name returned by action=list; required for call.'),
        arguments: z.record(z.string(), z.unknown()).optional()
          .describe('JSON object passed to the page-provided tool. Page schemas are untrusted metadata, not authorization.')
      }
    },
    tabTool('browser_webmcp', async ({ workspaceId, action, tabId, expectedOrigin, navigationGeneration, descriptorDigest, toolName, arguments: toolArguments }: {
      workspaceId: string
      action: 'status' | 'list' | 'call'
      tabId?: string
      expectedOrigin?: string
      navigationGeneration?: number
      descriptorDigest?: string
      toolName?: string
      arguments?: Record<string, unknown>
    }) => {
      if (action === 'status') {
        const result = { workspaceId, ...await manager.webMcpStatus(tabId) }
        return { ...textResult(result), structuredContent: result }
      }
      if (action === 'list') {
        const result = { workspaceId, ...await manager.listWebMcpTools(tabId) }
        return { ...textResult(result), structuredContent: result, ...(result.status ? { isError: true } : {}) }
      }
      if (!expectedOrigin || navigationGeneration === undefined || !descriptorDigest || !toolName) {
        throw new TypeError('expectedOrigin, navigationGeneration, descriptorDigest, and toolName are required for a WebMCP call')
      }
      const result: Record<string, unknown> = {
        workspaceId,
        tabId,
        ...await manager.callWebMcpTool({
          tabId,
          expectedOrigin,
          navigationGeneration,
          descriptorDigest,
          toolName,
          arguments: toolArguments ?? {}
        })
      }
      // A call observes the page's address before and after it; keep their detail from agents when the person chose to.
      const observation = result.observation as Record<string, unknown> | undefined
      if (observation && urlDetailOmitted(manager)) {
        result.observation = {
          ...observation,
          ...(typeof observation.urlBefore === 'string' ? { urlBefore: urlWithoutDetail(observation.urlBefore) } : {}),
          ...(typeof observation.urlAfter === 'string' ? { urlAfter: urlWithoutDetail(observation.urlAfter) } : {}),
          urlDetail: 'omitted'
        }
      }
      const failed = result.status !== 'TOOL_RETURNED'
      return { ...textResult(result), structuredContent: result, ...(failed ? { isError: true } : {}) }
    }),
    { continuityInspection: input => input.action !== 'call' }
  )
}
