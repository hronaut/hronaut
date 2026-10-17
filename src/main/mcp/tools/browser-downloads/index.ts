import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDownloads(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tool } = context
  registerWorkspaceTool(
    'browser_downloads',
    {
      description: toolDescription('browser_downloads'),
      inputSchema: {
        action: z.enum(['list', 'cancel', 'clear', 'pause', 'resume']).optional(),
        downloadId: z.string().optional()
      }
    },
    tool(async ({ workspaceId, action, downloadId }: {
      workspaceId?: string
      action?: 'list' | 'cancel' | 'clear' | 'pause' | 'resume'
      downloadId?: string
    }) =>
      textResult(manager.manageWorkspaceDownloads(workspaceId!, action ?? 'list', downloadId))
    ),
    { tabTarget: 'none' }
  )
}
