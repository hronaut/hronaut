import { z } from 'zod'
import { ARIA_NOTIFY_ACTIONS, ARIA_NOTIFY_LIMITS, type AriaNotifyAction } from '../../../../shared/aria-notify.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'
import { ariaNotify } from '../../../browser/aria-notify/browser-aria-notify.js'

export function registerBrowserAriaNotify(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_aria_notify',
    {
      description: toolDescription('browser_aria_notify'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(ARIA_NOTIFY_ACTIONS).default('get'),
        durationMs: z.number().int().min(ARIA_NOTIFY_LIMITS.minDurationMs).max(ARIA_NOTIFY_LIMITS.maxDurationMs).optional()
          .describe(`With start: how long to record before it stops itself; default ${ARIA_NOTIFY_LIMITS.defaultDurationMs}.`)
      }
    },
    tabTool('browser_aria_notify', async ({ tabId, action, durationMs }: { tabId: string; action: AriaNotifyAction; durationMs?: number }, call) => {
      const origin = (() => {
        try {
          return new URL(manager.tabs.get(tabId)?.webContents.getURL() ?? '').origin
        } catch {
          return ''
        }
      })()
      // Checked on every navigation and twice a second while recording, without renewing the agent's write ownership.
      return textResult(await ariaNotify(manager, tabId, action, { durationMs }, { assertCurrent: () => call.validateLifecycle(origin) }))
    })
    // Not read-only even for get: announcements are page text, so reading them takes the same permission as recording them.
  )
}
