import { z } from 'zod'
import type { SiteDataType } from '../../server.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserSiteData(context: McpToolContext): void {
  const { registerWorkspaceTool, siteData, tool } = context
  registerWorkspaceTool(
    'browser_site_data',
    {
      description: toolDescription('browser_site_data'),
      inputSchema: {
        action: z.enum(['inspect', 'clear']).default('inspect'),
        origin: z.string().trim().min(1).describe('Explicit HTTP or HTTPS website origin or URL.'),
        dataTypes: z.array(z.enum(['cookies-and-storage', 'cache', 'history'])).max(3).optional()
          .describe('Required for clear. Cookies and storage may sign the user out; open pages are not reloaded.')
      }
    },
    tool(async ({ workspaceId, action, origin, dataTypes }: {
      workspaceId?: string
      action: 'inspect' | 'clear'
      origin: string
      dataTypes?: SiteDataType[]
    }) => {
      if (action === 'inspect') return textResult(await siteData.inspect(workspaceId!, origin))
      if (!dataTypes?.length) throw new TypeError('dataTypes must select at least one category to clear')
      return textResult(await siteData.clear(workspaceId!, origin, [...new Set(dataTypes)]))
    })
  )
}
