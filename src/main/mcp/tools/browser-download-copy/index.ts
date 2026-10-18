import { z } from 'zod'
import type { DownloadCopyProgress } from '../../../browser/download-copy/download-copy.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserDownloadCopy(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_download_copy',
    {
      description: toolDescription('browser_download_copy'),
      inputSchema: {
        downloadId: z.string().min(1).max(100)
          .describe('The id of a completed download from browser_downloads in this workspace.'),
        directory: z.string().min(1).max(4096)
          .describe('Absolute path of an existing folder on the computer running Hronaut.'),
        filename: z.string().min(1).max(180)
          .describe('Name for the copy, without a folder; an existing name is refused, never replaced.')
      }
    },
    tool(async ({ workspaceId, downloadId, directory, filename }: {
      workspaceId?: string; downloadId: string; directory: string; filename: string
    }, call: WorkspaceToolCall) => {
      const progress: DownloadCopyProgress = { created: false, removed: false }
      // Re-checks the call before the copy is created, after each chunk and before its result is published.
      const validate = (): void => {
        if (call.signal?.aborted) throw new Error('Download copy cancelled')
        call.requireCurrentTarget()
      }
      try {
        const result = await manager.copyWorkspaceDownload(workspaceId!, { downloadId, directory, filename }, validate, progress)
        return { ...textResult(result), structuredContent: { ...result } }
      } catch (error) {
        // A copy that could not remove its own file may have left one behind.
        if (progress.created && !progress.removed) call.setInvalidatedOutcome('outcome-unknown')
        throw error
      }
    }),
    { tabTarget: 'none' }
  )
}
