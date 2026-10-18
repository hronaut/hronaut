import { z } from 'zod'
import type { BrowserVisualCompareReport, BrowserVisualSnapshot } from '../../../../shared/types.js'
import { titleWithoutUrlDetail, urlWithoutDetail } from '../../../../shared/url-detail.js'
import { toolDescription, urlDetailOmitted } from '../../tool-results.js'
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
      const report = urlDetailOmitted(manager) ? reportWithoutUrlDetail(result.report) : result.report
      return {
        content: [
          { type: 'text', text: JSON.stringify(cssStatePreview ? { ...report, cssStatePreview } : report, null, 2) },
          ...(result.diffPng ? [{ type: 'image' as const, data: result.diffPng.toString('base64'), mimeType: 'image/png' as const }] : [])
        ]
      }
    })
  )
}

/**
 * The report as agents read it when the person chose to keep URL query strings and fragments from them: the page's
 * address and those of both captures as origin and path, and a title that shows the address shortened the same way.
 */
function reportWithoutUrlDetail(report: BrowserVisualCompareReport): BrowserVisualCompareReport & { urlDetail: 'omitted' } {
  const capture = (snapshot?: BrowserVisualSnapshot) => snapshot && { ...snapshot, url: urlWithoutDetail(snapshot.url) }
  return {
    ...report,
    title: titleWithoutUrlDetail(report.title, report.url),
    url: urlWithoutDetail(report.url),
    ...(report.baseline ? { baseline: capture(report.baseline) } : {}),
    ...(report.current ? { current: capture(report.current) } : {}),
    urlDetail: 'omitted'
  }
}
