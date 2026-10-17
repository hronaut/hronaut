import { videoInspectionSchema } from '../../../../shared/video-inspection.js'
import { type BrowserVideoOptions, videoOptionsShape } from '../../../../shared/video.js'
import type { VideoSourceBinding } from '../../../browser/video-recorder.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserVideo(context: McpToolContext): void {
  const { client, frameRequests, manager, registerWorkspaceTool, requireActiveCapabilityDispatch, requireAgentWorkspace, tabTool, workspaceAuthorizationError, workspaceLeases } = context
  registerWorkspaceTool(
    'browser_video',
    { description: toolDescription('browser_video'), inputSchema: videoOptionsShape },
    tabTool('browser_video', async (input: BrowserVideoOptions, call) => {
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
        frameRequests.getStore()!.videoInspection = pending
        return textResult(pending.report)
      }
      return textResult(await manager.videoRecording(options, validateRecording, call.signal))
    }, 'never')
  )
}
