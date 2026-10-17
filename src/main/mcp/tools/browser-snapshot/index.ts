import { z } from 'zod'
import { FRAME_OBSERVATION_LIMITS } from '../../../../shared/frame-observation.js'
import { frameObservationResult } from '../../frame-observation-result.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserSnapshot(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_snapshot',
    {
      description: toolDescription('browser_snapshot'),
      inputSchema: {
        action: z.enum(['capture', 'set-baseline', 'delta', 'clear-baseline', 'assess-quality']).default('capture'),
        tabId: tabIdSchema.optional(),
        maxChars: z.number().int().min(1_000).max(100_000).optional()
          .describe('Bounded snapshot size for capture or set-baseline.'),
        frameSelector: z.string().trim().min(1).max(512).optional().describe('Unique directly embedded same-origin HTTP(S) iframe; capture only, no refs or context switch. Unsupported history is unavailable.'),
        rootSelector: z.string().trim().min(1).max(512).optional()
          .describe('Unique CSS component root for capture or set-baseline. Delta reuses the stored root; an explicit different selector is rejected. No whole-page fallback.'),
        baselineId: z.string().uuid().optional()
          .describe('Opaque baseline handle required by delta and optional for clear-baseline.'),
        maxOutputChars: z.number().int().min(1_000).max(50_000).optional()
          .describe('Maximum compact JSON characters returned by delta.'),
        advanceBaseline: z.boolean().optional()
          .describe('Advance a complete, untruncated baseline after delta; defaults to true.'),
        expectedOrigin: z.string().trim().min(1).max(2_048).optional()
          .describe('HTTP(S) origin or URL the resolved page must match during assess-quality.'),
        expectedText: z.string().trim().min(1).max(256).optional()
          .describe('Private required page text checked during assess-quality and never returned.'),
        expectedSelector: z.string().trim().min(1).max(512).optional()
          .describe('Private required visible CSS selector checked during assess-quality and never returned.')
      }
    },
    tabTool('browser_snapshot', async ({ action, tabId, maxChars, baselineId, maxOutputChars, advanceBaseline, expectedOrigin, expectedText, expectedSelector, rootSelector, frameSelector }: {
      action: 'capture' | 'set-baseline' | 'delta' | 'clear-baseline' | 'assess-quality'
      tabId?: string
      maxChars?: number
      rootSelector?: string
      frameSelector?: string
      baselineId?: string
      maxOutputChars?: number
      advanceBaseline?: boolean
      expectedOrigin?: string
      expectedText?: string
      expectedSelector?: string
    }) => {
      if (frameSelector !== undefined) {
        const request = frameRequests.getStore()!
        if (!tabId || !request.assertCurrent) throw new Error('Frame observation authority unavailable')
        request.pending = await manager.captureFrameObservation(tabId, frameSelector, maxChars ?? FRAME_OBSERVATION_LIMITS.defaultChars, request.assertCurrent)
        return frameObservationResult(request.pending.snapshot)
      }
      if (rootSelector !== undefined && action !== 'capture' && action !== 'set-baseline' && action !== 'delta') {
        throw new TypeError('rootSelector is supported only for capture, set-baseline and delta')
      }
      if (action === 'assess-quality') {
        const assessment = await manager.observationQuality({ tabId, expectedOrigin, expectedText, expectedSelector })
        return { ...textResult(assessment), structuredContent: { ...assessment } }
      }
      if (action === 'set-baseline') {
        const snapshot = await manager.setSnapshotBaseline(tabId, maxChars, rootSelector)
        return { ...textResult(snapshot.text), structuredContent: snapshot }
      }
      if (action === 'delta') {
        if (!baselineId) throw new TypeError('baselineId is required for a snapshot delta')
        const delta = await manager.snapshotDelta({ tabId, baselineId, rootSelector, maxOutputChars, advanceBaseline })
        return { content: [{ type: 'text', text: JSON.stringify(delta) }], structuredContent: delta }
      }
      if (action === 'clear-baseline') {
        const cleared = manager.clearSnapshotBaseline(tabId, baselineId)
        return { ...textResult(cleared), structuredContent: cleared }
      }
      const snapshot = rootSelector === undefined
        ? await manager.snapshotDetails(tabId, maxChars)
        : await manager.snapshotDetails(tabId, maxChars, rootSelector)
      return { ...textResult(snapshot.text), structuredContent: { ...snapshot } }
    })
  )
}
