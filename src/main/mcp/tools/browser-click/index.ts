import { z } from 'zod'
import type { NativeClickProgress } from '../../../browser/native-click-admission.js'
import { agentCursorIdentity } from '../../agent-presence.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { type PostWriteRequest, type ReconciliationConditionRequest, reconciliationRequestSchema, tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function browserClickPageInput<T extends object>(input: T & { postcondition?: unknown; reconciliation?: unknown }): Omit<T, 'postcondition' | 'reconciliation'> {
  const { postcondition: _postcondition, reconciliation: _reconciliation, ...pageInput } = input
  return pageInput
}

export function registerBrowserClick(context: McpToolContext): void {
  const { client, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_click',
    {
      description: toolDescription('browser_click'),
      inputSchema: {
        tabId: tabIdSchema.optional(),
        ref: z.string().optional(),
        selector: z.string().optional(),
        x: z.number().finite().min(0).max(100_000).optional()
          .describe('Viewport-relative CSS x coordinate. Provide together with y and without ref or selector.'),
        y: z.number().finite().min(0).max(100_000).optional()
          .describe('Viewport-relative CSS y coordinate. Provide together with x and without ref or selector.'),
        button: z.enum(['left', 'right']).optional()
          .describe('Omit for the existing left click. Right requires native=true, an explicit tabId and one ref or selector, on an already active visible awake locked Linux page with default geometry. Opens a page menu only; selection is separate. No automatic replay.'),
        doubleClick: z.boolean().optional()
          .describe('Dispatch two native pointer clicks and a dblclick event instead of one native pointer click.'),
        native: z.boolean().optional()
          .describe('For a single ref or selector click, dispatch trusted native pointer and mouse events. Use only when the control does not respond to the default exact-element click.'),
        dialogAction: z.enum(['accept', 'dismiss']).optional(),
        promptText: z.string().max(4096).optional(),
        postcondition: z.object({
          expectedOrigin: z.string().max(2048).describe('Exact HTTP(S) origin expected after the click.'),
          accountSelector: z.string().trim().min(1).max(256).describe('Unique selector whose bounded text identifies the expected account.'),
          expectedAccount: z.string().trim().min(1).max(512).describe('Exact expected account-marker text. Kept local and excluded from receipts.'),
          stateSelector: z.string().trim().min(1).max(256).describe('Unique selector for the action-relevant state.'),
          expectedText: z.string().max(512).describe('Exact expected state text. Kept local and excluded from receipts.'),
          timeoutMs: z.number().int().min(250).max(30_000).default(10_000),
          maxAttempts: z.number().int().min(1).max(5).default(4),
          initialDelayMs: z.number().int().min(50).max(5_000).default(250)
        }).strict().optional().describe('After one click, perform bounded read-only checks with backoff. Requires an active action-receipt run; Hronaut never repeats the click.'),
        reconciliation: reconciliationRequestSchema.optional().describe('Repeat a bounded pre-write lookup immediately before dispatch. Must describe the same target and desired state as postcondition; a missing, stale, ambiguous, or already-satisfied target prevents the click.')
      }
    },
    tabTool('browser_click', async ({ validateNativeInput, recordClickProgress, retainClickAuthority, ...input }: {
      tabId?: string
      ref?: string
      selector?: string
      x?: number
      y?: number
      doubleClick?: boolean
      native?: boolean
      button?: 'left' | 'right'
      retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void
      recordClickProgress?: (progress: NativeClickProgress) => void
      validateNativeInput?: (validateContext: () => void) => void
      dialogAction?: 'accept' | 'dismiss'
      promptText?: string
      postcondition?: PostWriteRequest
      reconciliation?: ReconciliationConditionRequest & {
        logicalItemKey: string
        targetIdentity: string
        sourceRevision: string
      }
    }) => {
      if (!validateNativeInput) throw new Error('Click authority is unavailable')
      return textResult(await manager.click(browserClickPageInput(input), validateNativeInput, recordClickProgress, retainClickAuthority, agentCursorIdentity(client.name)))
    })
  )
}
