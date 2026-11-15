import { type FrameStreamInput, frameStream, frameStreamFields } from '../../../browser/frame-stream/frame-stream.js'
import { toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { pageObservationSettlement, type PageObservationSettlement } from '../page-observation-settlement.js'

export function registerBrowserFrameStream(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_frame_stream',
    { description: toolDescription('browser_frame_stream'), inputSchema: { tabId: tabIdSchema, ...frameStreamFields } },
    tabTool('browser_frame_stream', async (input: FrameStreamInput, call: WorkspaceToolCall<PageObservationSettlement>) => {
      // Rechecks the call while starting a stream and while a read waits for a frame.
      const validate = (): void => {
        if (call.signal?.aborted) throw new Error('Frame stream call cancelled')
        call.requireCurrentTarget()
      }
      // Only the stream's own fields; the workspace wrapper has already checked the rest of the call.
      const fields = Object.fromEntries(['tabId', ...Object.keys(frameStreamFields)]
        .filter(key => (input as Record<string, unknown>)[key] !== undefined)
        .map(key => [key, (input as Record<string, unknown>)[key]])) as FrameStreamInput
      const { report, images } = await frameStream(manager, fields, validate, call.signal)
      return { content: [{ type: 'text' as const, text: JSON.stringify(report) }, ...images.map(image => ({ type: 'image' as const, ...image }))] }
    }, 'never'),
    {
      // Frames are page pixels, published like a screenshot only while the call keeps its target and observation access.
      settlement: () => pageObservationSettlement(manager),
      preservesPresentation: () => true,
      readOnly: input => input.action === 'read'
    }
  )
}
