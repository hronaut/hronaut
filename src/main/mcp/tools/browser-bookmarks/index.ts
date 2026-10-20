import { z } from 'zod'
import type { BrowserBookmark } from '../../../../shared/types.js'
import type { McpCapabilityProfile } from '../../capability-profile-store.js'
import { textResult, toolDescription } from '../../tool-results.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserBookmarks(context: McpToolContext): void {
  const {
    bookmarks,
    capabilityAllowsUrl,
    manager,
    registerWorkspaceTool,
    requireActiveCapabilityDispatch,
    tool
  } = context
  registerWorkspaceTool(
    'browser_bookmarks',
    {
      description: toolDescription('browser_bookmarks'),
      inputSchema: {
        action: z.enum(['list', 'add', 'rename', 'remove', 'open']).default('list'),
        id: z.string().optional().describe('Bookmark ID for rename, remove, or open.'),
        url: z.string().optional().describe('HTTP or HTTPS address to bookmark.'),
        title: z.string().optional().describe('Bookmark title for add or rename. Adding an address that is already bookmarked leaves that bookmark and its title unchanged; use rename to change it.'),
        active: z.boolean().optional().describe('Whether an opened bookmark becomes the active tab.')
      }
    },
    tool(async ({ workspaceId, action, id, url, title, active }: {
      workspaceId?: string
      action: 'list' | 'add' | 'rename' | 'remove' | 'open'
      id?: string
      url?: string
      title?: string
      active?: boolean
    }) => {
      const input = { workspaceId, action, id, url, title, active }
      const visibleBookmarks = (profile: McpCapabilityProfile | undefined, entries: BrowserBookmark[]): BrowserBookmark[] => (
        entries.filter((entry) => capabilityAllowsUrl(profile, entry.url))
      )
      if (action === 'list') {
        const profile = requireActiveCapabilityDispatch('browser_bookmarks', input)
        return textResult(visibleBookmarks(profile, bookmarks.list()))
      }
      if (action === 'add') {
        if (!url) throw new TypeError('url is required to add a bookmark')
        const profile = requireActiveCapabilityDispatch('browser_bookmarks', input)
        return textResult(visibleBookmarks(profile, await bookmarks.add(url, title ?? url)))
      }
      if (!id) throw new TypeError(`id is required to ${action} a bookmark`)
      const bookmark = bookmarks.list().find((candidate) => candidate.id === id)
      if (!bookmark) throw new Error(`Bookmark not found: ${id}`)
      const profile = requireActiveCapabilityDispatch('browser_bookmarks', { ...input, url: bookmark.url })
      if (action === 'rename') {
        if (title === undefined) throw new TypeError('title is required to rename a bookmark')
        return textResult(visibleBookmarks(profile, await bookmarks.rename(id, title)))
      }
      if (action === 'remove') return textResult(visibleBookmarks(profile, await bookmarks.remove(id)))
      return textResult(await manager.newAgentTab({ url: bookmark.url, active, mcpGroupId: workspaceId! }))
    }),
    { tabTarget: 'none', pageOrigins: 'none' }
  )
}
