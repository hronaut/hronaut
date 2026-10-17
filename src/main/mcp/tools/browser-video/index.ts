import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { videoInspectionSchema } from '../../../../shared/video-inspection.js'
import { type BrowserVideoOptions, videoOptionsShape } from '../../../../shared/video.js'
import type { PendingVideoInspection, VideoSourceBinding } from '../../../browser/video-recorder.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

// An inspected frame and its pixels are published only if the call still has its authority when it settles.
function videoInspectionSettlement() {
  let pending: PendingVideoInspection | undefined
  return {
    retain: (inspection: PendingVideoInspection): void => { pending = inspection },
    publish: (result: CallToolResult): CallToolResult | undefined => {
      if (!pending || result.isError) return undefined
      // No await after this check: capability/human/audit settlement must precede pixel publication.
      const inspection = pending
      inspection.assertCurrent()
      return { content: [
        { type: 'text', text: JSON.stringify(inspection.report) },
        ...(inspection.image ? [{ type: 'image' as const, data: Buffer.from(inspection.image).toString('base64'), mimeType: 'image/png' as const }] : [])
      ] }
    },
    dispose: (): void => { pending?.discard() }
  }
}

export function registerBrowserVideo(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, requireActiveCapabilityDispatch, requireAgentWorkspace, tabTool, workspaceAuthorizationError, workspaceLeases } = context
  registerWorkspaceTool(
    'browser_video',
    { description: toolDescription('browser_video'), inputSchema: videoOptionsShape },
    tabTool('browser_video', async (input: BrowserVideoOptions, call: WorkspaceToolCall<ReturnType<typeof videoInspectionSettlement>>) => {
      const validateInspection = (source: VideoSourceBinding): void => {
        if (call.signal?.aborted) throw new Error('Video inspection cancelled')
        call.requireCurrentTarget()
        if (source.workspaceId !== call.workspaceId || source.tabId !== call.tabId) throw workspaceAuthorizationError()
        requireActiveCapabilityDispatch('browser_video', call.input, { workspaceId: call.workspaceId, tabId: call.tabId, origins: [source.origin] })
      }
      const validateRecording = (): void => {
        if (call.signal?.aborted) throw new Error('Video operation was cancelled')
        call.requireCurrentControl()
        requireActiveCapabilityDispatch('browser_video', call.input)
        requireAgentWorkspace(call.workspaceId)
        if (call.writeLeaseGeneration) workspaceLeases.require(call.workspaceId, client.id, call.writeLeaseGeneration)
        if (call.tabId && !manager.tabBelongsToMcpGroup(call.workspaceId, call.tabId)) throw workspaceAuthorizationError()
      }
      const options = Object.fromEntries(Object.keys(videoOptionsShape).filter(key => (input as Record<string, unknown>)[key] !== undefined).map(key => [key, (input as Record<string, unknown>)[key]])) as BrowserVideoOptions
      if (options.action === 'inspect') {
        const pending = await manager.inspectVideo(videoInspectionSchema.parse(options), validateInspection, call.signal)
        call.settlement.retain(pending)
        return textResult(pending.report)
      }
      return textResult(await manager.videoRecording(options, validateRecording, call.signal))
    }, 'never'),
    {
      settlement: videoInspectionSettlement,
      readOnly: input => input.action === 'inspect'
    }
  )
}
