import { createHash } from 'node:crypto'
import { z } from 'zod'
import { REACT_INSPECTION_ACTIONS, type ReactInspectionCommand } from '../../../../shared/react-inspection.js'
import type { ReactInspectionAuthority } from '../../../browser/react-inspection.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserReact(context: McpToolContext): void {
  const { capabilityAuthorizationFingerprint, client, manager, registerWorkspaceTool, tabTool } = context
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
    tabTool('browser_react', async ({ tabId, action, subtreeId }: ReactInspectionCommand & { tabId: string }, call) => {
      const reactAuthority: ReactInspectionAuthority = {
        assertCurrent: call.requireCurrentTarget,
        epoch: createHash('sha256').update(JSON.stringify([client.id, call.controlRevision, call.writeLeaseGeneration, capabilityAuthorizationFingerprint])).digest('hex')
      }
      return textResult(await manager.reactInspection(tabId, { action, subtreeId }, reactAuthority))
    }, 'never')
  )
}
