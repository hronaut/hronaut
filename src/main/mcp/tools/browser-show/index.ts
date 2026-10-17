import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserShow(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, showWindowInactive, tool } = context
  registerWorkspaceTool(
    'browser_show',
    { description: toolDescription('browser_show'), inputSchema: {} },
    tool(async ({ tabId }: { tabId?: string }) => {
      if (tabId) await manager.selectTabAndWait(tabId, { focus: false })
      showWindowInactive()
      return textResult('Browser window is visible without taking keyboard or mouse focus.')
    }),
    { tabTarget: 'if-any', continuityInspection: () => true }
  )
}
