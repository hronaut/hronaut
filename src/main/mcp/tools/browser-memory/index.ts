import { z } from 'zod'
import { HEAP_SNAPSHOT_LIMITS } from '../../../../shared/heap-snapshot.js'
import { heapSnapshots } from '../../../browser/heap-snapshot/browser-heap-snapshots.js'
import type { HeapSnapshotAction } from '../../../browser/heap-snapshot/heap-snapshots.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

const MEASUREMENT_ACTIONS = [
  'measure',
  'set-baseline',
  'clear-baseline',
  'start-allocation-sampling',
  'stop-allocation-sampling',
  'clear-allocation-sampling'
] as const
type MeasurementAction = typeof MEASUREMENT_ACTIONS[number]

const HEAP_SNAPSHOT_ACTIONS = ['take-heap-snapshot', 'list-heap-snapshots', 'compare-heap-snapshots', 'clear-heap-snapshots'] as const

function heapSnapshotAction(action: string): action is HeapSnapshotAction {
  return (HEAP_SNAPSHOT_ACTIONS as readonly string[]).includes(action)
}

export function registerBrowserMemory(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_memory',
    {
      description: toolDescription('browser_memory'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        action: z.enum([...MEASUREMENT_ACTIONS, ...HEAP_SNAPSHOT_ACTIONS]).default('measure'),
        collectGarbage: z.boolean().default(false),
        label: z.string().min(1).max(HEAP_SNAPSHOT_LIMITS.maxLabelChars).optional()
          .describe('With take-heap-snapshot: a short name for the snapshot, such as "after 10 route changes".'),
        baseSnapshotId: z.string().min(1).max(40).optional()
          .describe('With compare-heap-snapshots: the earlier snapshot; default the second latest.'),
        targetSnapshotId: z.string().min(1).max(40).optional()
          .describe('With compare-heap-snapshots: the later snapshot; default the latest.'),
        limit: z.number().int().min(1).max(HEAP_SNAPSHOT_LIMITS.maxLimit).optional()
          .describe(`With take-heap-snapshot or compare-heap-snapshots: classes or changes to return; default ${HEAP_SNAPSHOT_LIMITS.defaultLimit}.`)
      }
    },
    tabTool('browser_memory', async ({ tabId, action, collectGarbage, label, baseSnapshotId, targetSnapshotId, limit }: {
      tabId?: string
      action: MeasurementAction | HeapSnapshotAction
      collectGarbage: boolean
      label?: string
      baseSnapshotId?: string
      targetSnapshotId?: string
      limit?: number
    }) => {
      if (heapSnapshotAction(action)) return textResult(await heapSnapshots(manager, { tabId, action, label, baseSnapshotId, targetSnapshotId, limit }))
      if (label !== undefined || baseSnapshotId !== undefined || targetSnapshotId !== undefined || limit !== undefined) {
        throw new Error('label, baseSnapshotId, targetSnapshotId and limit are only for the heap snapshot actions')
      }
      return textResult(await manager.profiling.memoryReport({ tabId, action, collectGarbage }))
    })
  )
}
