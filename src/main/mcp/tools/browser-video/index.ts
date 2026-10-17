import { videoInspectionSchema } from '../../../../shared/video-inspection.js'
import { type BrowserVideoOptions, videoOptionsShape } from '../../../../shared/video.js'
import type { VideoSourceBinding } from '../../../browser/video-recorder.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserVideo(context: McpToolContext): void {
  const { frameRequests, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_video',
    { description: toolDescription('browser_video'), inputSchema: videoOptionsShape },
    tabTool('browser_video', async ({ validateRecording, validateInspection, recordingSignal, ...input }: BrowserVideoOptions & { validateRecording?: () => void; validateInspection?: (source: VideoSourceBinding) => void; recordingSignal?: AbortSignal }) => {
      const options = Object.fromEntries(Object.keys(videoOptionsShape).filter(key => (input as Record<string, unknown>)[key] !== undefined).map(key => [key, (input as Record<string, unknown>)[key]])) as BrowserVideoOptions
      if (options.action === 'inspect') {
        if (!validateInspection) throw new Error('Video inspection authority is unavailable')
        const pending = await manager.inspectVideo(videoInspectionSchema.parse(options), validateInspection, recordingSignal)
        frameRequests.getStore()!.videoInspection = pending
        return textResult(pending.report)
      }
      return textResult(await manager.videoRecording(options, validateRecording, recordingSignal))
    }, 'never')
  )
}
