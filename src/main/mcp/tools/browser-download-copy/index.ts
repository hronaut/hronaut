import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type DownloadCopySettlement, downloadCopySettlement } from './download-copy-settlement.js'

export function registerBrowserDownloadCopy(context: McpToolContext): void {
  const { capability, manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_download_copy',
    {
      description: toolDescription('browser_download_copy'),
      inputSchema: {
        downloadId: z.string().min(1).max(100)
          .describe('The id of a completed download from browser_downloads in this workspace.'),
        directory: z.string().min(1).max(4096)
          .describe('Absolute path of an existing folder on the computer running Hronaut, exactly as the capability profile lists it.'),
        filename: z.string().min(1).max(180)
          .describe('Name for the copy, without a folder; an existing name is refused, never replaced.')
      }
    },
    tool(async ({ workspaceId, downloadId, directory, filename }: {
      workspaceId?: string; downloadId: string; directory: string; filename: string
    }, call: WorkspaceToolCall<DownloadCopySettlement>) => {
      const progress = call.settlement.progress
      // Re-checks the call before the copy is created, after each chunk and before its result is published.
      const validate = (): void => {
        if (call.signal?.aborted) throw new Error('Download copy cancelled')
        call.requireCurrentTarget()
      }
      try {
        const result = await manager.copyWorkspaceDownload(workspaceId!, { downloadId, directory, filename }, validate, progress)
        progress.copied = true
        return { ...textResult(result), structuredContent: { ...result } }
      } catch (error) {
        // A copy that could not confirm its own file is gone may have left one behind; the settlement says so.
        if (progress.created && !progress.removed) call.setInvalidatedOutcome('outcome-unknown')
        throw error
      }
    }),
    { tabTarget: 'none', settlement: () => downloadCopySettlement(capability !== undefined) }
  )
}
