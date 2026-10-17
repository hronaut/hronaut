import { z } from 'zod'
import { REACT_INSPECTION_ACTIONS, type ReactInspectionCommand } from '../../../../shared/react-inspection.js'
import type { ReactInspectionAuthority } from '../../../browser/react-inspection.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserReact(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_react',
    {
      description: toolDescription('browser_react'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(REACT_INSPECTION_ACTIONS),
        subtreeId: z.string().min(1).max(240).optional()
      }
    },
    tabTool('browser_react', async ({ tabId, action, subtreeId, reactAuthority }: ReactInspectionCommand & { tabId: string; reactAuthority: ReactInspectionAuthority }) =>
      textResult(await manager.reactInspection(tabId, { action, subtreeId }, reactAuthority)), 'never')
  )
}
