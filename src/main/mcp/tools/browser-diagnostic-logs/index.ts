import { z } from 'zod'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDiagnosticLogs(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_diagnostic_logs',
    {
      description: toolDescription('browser_diagnostic_logs'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum(['get', 'set', 'clear']).default('get'),
        preserveAcrossNavigation: z.boolean().optional().describe('Required for set. When false, a new main-frame navigation clears previous Console and Network evidence before recording the new document.')
      }
    },
    tabTool('browser_diagnostic_logs', async ({ tabId, action, preserveAcrossNavigation }: {
      tabId?: string
      action: 'get' | 'set' | 'clear'
      preserveAcrossNavigation?: boolean
    }) => {
      if (action === 'get') return textResult(manager.diagnosticLogState(tabId))
      if (action === 'clear') return textResult(manager.clearDiagnosticLogs(tabId))
      if (preserveAcrossNavigation === undefined) throw new TypeError('preserveAcrossNavigation is required to set diagnostic log behavior')
      return textResult(manager.setDiagnosticLogPreservation(tabId!, preserveAcrossNavigation))
    })
  )
}
