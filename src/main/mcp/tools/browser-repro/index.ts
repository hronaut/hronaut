import { z } from 'zod'
import { reproCheckpointSchema } from '../../../../shared/repro-checkpoint.js'
import { formatReproAsPlaywright } from '../../../../shared/repro-export.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserRepro(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_repro',
    {
      description: toolDescription('browser_repro'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['start', 'get', 'stop', 'clear', 'checkpoint']).default('get'),
        format: z.enum(['json', 'playwright']).default('json'),
        checkpoint: reproCheckpointSchema.optional()
      }
    },
    tabTool('browser_repro', async ({
      tabId,
      action,
      format, checkpoint
    }: {
      tabId?: string
      action: 'start' | 'get' | 'stop' | 'clear' | 'checkpoint'
      format: 'json' | 'playwright'
      checkpoint?: z.infer<typeof reproCheckpointSchema>
    }) => {
      const recording = await manager.reproRecording(action, tabId, checkpoint)
      return textResult(format === 'playwright' ? formatReproAsPlaywright(recording) : recording)
    })
  )
}
