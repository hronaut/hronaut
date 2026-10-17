import { z } from 'zod'
import type { StorageInspectionHooks } from '../../../browser/storage-inspection-operation.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

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
    tabTool('browser_indexeddb', async ({ tabId, database, objectStore, offset, limit, includeValues, storageInspectionHooks }: {
      storageInspectionHooks?: StorageInspectionHooks
      tabId?: string
      database?: string
      objectStore?: string
      offset: number
      limit: number
      includeValues: boolean
    }) => textResult(await manager.inspectIndexedDb({ tabId, database, objectStore, offset, limit, includeValues }, storageInspectionHooks)))
  )
}
