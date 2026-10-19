import { z } from 'zod'
import { VIRTUAL_PASSKEY_ACTIONS, VIRTUAL_PASSKEY_LIMITS, type VirtualPasskeyAction } from '../../../../shared/virtual-passkey.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'
import { type VirtualPasskeySettlement, virtualPasskeySettlement } from './virtual-passkey-settlement.js'

export function registerBrowserVirtualPasskey(context: McpToolContext): void {
  const { capability, manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_virtual_passkey',
    {
      description: toolDescription('browser_virtual_passkey'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(VIRTUAL_PASSKEY_ACTIONS),
        origin: z.string().min(1).max(VIRTUAL_PASSKEY_LIMITS.maxOriginChars)
          .describe('The exact localhost origin, such as http://localhost:3000, as the capability profile lists it; required for every action.'),
        userVerified: z.boolean().optional()
          .describe('With start (default true) or configure: whether the authenticator reports user verification as passed; false makes sign-ins that require it fail.'),
        durationMs: z.number().int().min(VIRTUAL_PASSKEY_LIMITS.minDurationMs).max(VIRTUAL_PASSKEY_LIMITS.maxDurationMs).optional()
          .describe(`With start: how long the authenticator lasts before it ends itself; default ${VIRTUAL_PASSKEY_LIMITS.defaultDurationMs}.`)
      }
    },
    tabTool('browser_virtual_passkey', async ({ tabId, action, origin, userVerified, durationMs }: {
      tabId: string; action: VirtualPasskeyAction; origin: string; userVerified?: boolean; durationMs?: number
    }, call: WorkspaceToolCall<VirtualPasskeySettlement>) => textResult(await manager.virtualPasskey(tabId, action, { origin, userVerified, durationMs }, {
      // Checked on every navigation in the page and four times a second, without renewing write ownership.
      assertCurrent: () => call.validateLifecycle(origin)
    }))),
    { readOnly: input => input.action === 'status', settlement: () => virtualPasskeySettlement(capability !== undefined) }
  )
}
