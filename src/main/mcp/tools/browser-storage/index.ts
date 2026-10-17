import { z } from 'zod'
import type { CookieWriteHooks } from '../../../browser/cookie-write-operation.js'
import type { WebStorageHooks } from '../../../browser/web-storage-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserStorage(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_storage',
    {
      description: toolDescription('browser_storage'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        kind: z.enum(['local-storage', 'session-storage', 'cookies']),
        action: z.enum(['list', 'get', 'set', 'delete', 'clear']).default('list'),
        key: z.string().max(512).optional().describe('Required for get, set, and delete.'),
        value: z.string().max(256 * 1024).optional().describe('Required for set. Limited to 256 KiB.'),
        includeValues: z.boolean().default(false).describe('Include bounded values when listing. Explicit get always returns the bounded value. HttpOnly cookie values are never exposed.'),
        cookieDomain: z.string().min(1).max(255).optional()
          .describe('Cookie delete only: exact domain from a cookie listing, including any leading dot. Requires cookiePath and deletes only that one cookie.'),
        cookiePath: z.string().min(1).max(1024).startsWith('/').optional()
          .describe('Cookie delete only: exact path from a cookie listing. Requires cookieDomain; no prefix or wildcard matching.')
      }
    },
    tabTool('browser_storage', async ({ tabId, kind, action, key, value, includeValues, cookieDomain, cookiePath, cookieWriteHooks, webStorageHooks }: {
      tabId?: string
      kind: 'local-storage' | 'session-storage' | 'cookies'
      action: 'list' | 'get' | 'set' | 'delete' | 'clear'
      key?: string
      value?: string
      includeValues: boolean
      cookieDomain?: string
      cookiePath?: string
      cookieWriteHooks?: CookieWriteHooks
      webStorageHooks?: WebStorageHooks
    }) => textResult(await manager.manageStorage({ tabId, kind, action, key, value, includeValues, cookieDomain, cookiePath }, cookieWriteHooks, webStorageHooks)))
  )
}
