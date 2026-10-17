import { z } from 'zod'
import type { StorageInspectionHooks } from '../../../browser/storage-inspection-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { type StorageInspectionSettlement, storageInspectionSettlement } from '../storage-inspection-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserIndexeddb(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_indexeddb',
    {
      description: toolDescription('browser_indexeddb'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        database: z.string().min(1).max(512).optional()
          .describe('Select a database to inspect its object-store schema.'),
        objectStore: z.string().min(1).max(512).optional()
          .describe('Select an object store to return ordered records. Requires database.'),
        offset: z.number().int().min(0).max(10_000).default(0),
        limit: z.number().int().min(1).max(100).default(50),
        includeValues: z.boolean().default(false)
          .describe('Include bounded record previews. Values may contain private application data.')
      }
    },
    tabTool('browser_indexeddb', async ({ tabId, database, objectStore, offset, limit, includeValues }: {
      tabId?: string
      database?: string
      objectStore?: string
      offset: number
      limit: number
      includeValues: boolean
    }, call: WorkspaceToolCall<StorageInspectionSettlement>) => {
      const storageInspectionHooks = {
        validate: () => {
          try {
            if (call.signal?.aborted) throw new Error('Storage inspection cancelled')
            call.requireCurrentTarget()
          } catch (error) { call.rememberInputPolicy(error); throw error }
        },
        readStarted: call.settlement.markStarted,
        retainPublication: call.settlement.retainPublication
      } satisfies StorageInspectionHooks
      return textResult(await manager.inspectIndexedDb({ tabId, database, objectStore, offset, limit, includeValues }, storageInspectionHooks))
    }),
    { settlement: () => storageInspectionSettlement() }
  )
}
