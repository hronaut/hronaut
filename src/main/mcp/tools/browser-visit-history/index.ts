import { z } from 'zod'
import type { BrowserHistoryEntry } from '../../../../shared/types.js'
import { McpCapabilityAuthorizationError, type McpCapabilityProfile } from '../../capability-profile-store.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserVisitHistory(context: McpToolContext): void {
  const {
    capabilityAllowsUrl,
    history,
    manager,
    registerWorkspaceTool,
    requireActiveCapabilityDispatch,
    tool
  } = context
  registerWorkspaceTool(
    'browser_visit_history',
    {
      description: toolDescription('browser_visit_history'),
      inputSchema: {
        action: z.enum(['list', 'remove', 'clear', 'open']).default('list'),
        id: z.string().optional().describe('History entry ID for remove or open.'),
        query: z.string().max(500).optional().describe('Optional title or URL search for list.'),
        limit: z.number().int().min(1).max(200).default(100),
        active: z.boolean().optional().describe('Whether a reopened history entry becomes the active tab.')
      }
    },
    tool(async ({ workspaceId, action, id, query, limit, active }: {
      workspaceId?: string
      action: 'list' | 'remove' | 'clear' | 'open'
      id?: string
      query?: string
      limit: number
      active?: boolean
    }) => {
      const input = { workspaceId, action, id, query, limit, active }
      const visibleHistory = (profile: McpCapabilityProfile | undefined, entries: BrowserHistoryEntry[]): BrowserHistoryEntry[] => (
        entries.filter((entry) => capabilityAllowsUrl(profile, entry.url))
      )
      if (action === 'clear') {
        const profile = requireActiveCapabilityDispatch('browser_visit_history', input)
        if (profile?.origins) throw new McpCapabilityAuthorizationError()
        return textResult(await history.clear())
      }
      if (action === 'list') {
        const profile = requireActiveCapabilityDispatch('browser_visit_history', input)
        const normalizedQuery = query?.trim().toLocaleLowerCase()
        const entries = normalizedQuery
          ? history.list().filter((entry) => (
            entry.title.toLocaleLowerCase().includes(normalizedQuery)
            || entry.url.toLocaleLowerCase().includes(normalizedQuery)
          ))
          : history.list()
        return textResult(visibleHistory(profile, entries).slice(0, limit))
      }
      if (!id) throw new TypeError(`id is required to ${action} a history entry`)
      const entry = history.list().find((candidate) => candidate.id === id)
      if (!entry) throw new Error(`History entry not found: ${id}`)
      const profile = requireActiveCapabilityDispatch('browser_visit_history', { ...input, url: entry.url })
      if (action === 'remove') return textResult(visibleHistory(profile, await history.remove(id)))
      return textResult(await manager.newAgentTab({ url: entry.url, active, mcpGroupId: workspaceId! }))
    })
  )
}
