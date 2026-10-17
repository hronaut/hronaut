import { z } from 'zod'
import type { CookieWriteHooks } from '../../../browser/cookie-write-operation.js'
import type { WebStorageHooks } from '../../../browser/web-storage-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type CookieWriteSettlement, cookieWriteSettlement } from './cookie-write-settlement.js'
import { type WebStorageSettlement, webStorageSettlement } from './web-storage-settlement.js'

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
    tabTool('browser_storage', async ({ tabId, kind, action, key, value, includeValues, cookieDomain, cookiePath }: {
      tabId?: string
      kind: 'local-storage' | 'session-storage' | 'cookies'
      action: 'list' | 'get' | 'set' | 'delete' | 'clear'
      key?: string
      value?: string
      includeValues: boolean
      cookieDomain?: string
      cookiePath?: string
    }, call: WorkspaceToolCall<CookieWriteSettlement | WebStorageSettlement | undefined>) => {
      // Progress is tracked only for cookie writes and for local or session storage.
      const settlement = call.settlement
      const webStorageHooks = settlement?.storage === 'web' ? {
        validate: () => {
          try {
            if (call.signal?.aborted) throw new Error('Storage operation cancelled')
            call.requireCurrentTarget()
          } catch (error) { call.rememberInputPolicy(error); throw error }
        },
        progress: settlement.recordProgress,
        retainPublication: settlement.retainPublication
      } satisfies WebStorageHooks : undefined
      const cookieWriteHooks = settlement?.storage === 'cookies' ? {
        validate: () => {
          try {
            if (call.signal?.aborted) throw new Error('Cookie operation cancelled')
            call.requireCurrentTarget()
          } catch (error) { call.rememberInputPolicy(error); throw error }
        },
        progress: settlement.recordProgress,
        retainPublication: settlement.retainPublication
      } satisfies CookieWriteHooks : undefined
      return textResult(await manager.manageStorage({ tabId, kind, action, key, value, includeValues, cookieDomain, cookiePath }, cookieWriteHooks, webStorageHooks))
    }),
    {
      settlement: input => {
        const writes = ['set', 'delete', 'clear'].includes(String(input.action))
        if (input.kind === 'cookies' && writes) return cookieWriteSettlement()
        return ['local-storage', 'session-storage'].includes(String(input.kind)) ? webStorageSettlement(writes) : undefined
      }
    }
  )
}
