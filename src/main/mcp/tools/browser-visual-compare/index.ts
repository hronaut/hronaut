import { z } from 'zod'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserVisualCompare(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, requireActiveCapabilityDispatch, requireAgentWorkspace, tabTool, workspaceAuthorizationError, workspaceLeases } = context
  registerWorkspaceTool(
    'browser_visual_compare',
    {
      description: toolDescription('browser_visual_compare'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'set-baseline', 'compare', 'clear']).default('get'),
        threshold: z.number().int().min(0).max(255).optional(),
        settleMs: z.number().int().min(0).max(2_000).optional(),
        clip: z.object({
          x: z.number().finite().min(0), y: z.number().finite().min(0),
          width: z.number().finite().positive(), height: z.number().finite().positive()
        }).optional()
      }
    },
    tabTool('browser_visual_compare', async ({
      tabId,
      action,
      threshold,
      settleMs,
      clip
    }: {
      tabId?: string
      action: 'get' | 'set-baseline' | 'compare' | 'clear'
      threshold?: number
      settleMs?: number
      clip?: { x: number; y: number; width: number; height: number }
    }, call) => {
      const validateCapture = (): void => {
        if (call.signal?.aborted) throw new Error('Visual comparison was cancelled')
        call.requireCurrentControl()
        call.requireCurrentHumanInput()
        requireActiveCapabilityDispatch('browser_visual_compare', call.input)
        requireAgentWorkspace(call.workspaceId)
        if (call.writeLeaseGeneration) workspaceLeases.require(call.workspaceId, client.id, call.writeLeaseGeneration)
        if (call.tabId && !manager.tabBelongsToMcpGroup(call.workspaceId, call.tabId)) throw workspaceAuthorizationError()
      }
      const previewBefore = action === 'get' || action === 'clear' ? undefined : manager.cssStatePreviewMarker(tabId)
      const result = await manager.visualCompare({ tabId, action, threshold, settleMs, clip }, validateCapture)
      const cssStatePreview = action === 'get' || action === 'clear' ? undefined : previewBefore ?? manager.cssStatePreviewMarker(tabId)
      return {
        content: [
          { type: 'text', text: JSON.stringify(cssStatePreview ? { ...result.report, cssStatePreview } : result.report, null, 2) },
          ...(result.diffPng ? [{ type: 'image' as const, data: result.diffPng.toString('base64'), mimeType: 'image/png' as const }] : [])
        ]
      }
    })
  )
}
