import { z } from 'zod'
import {
  DOM_MUTATION_SOURCE_ACTIONS,
  DOM_MUTATION_SOURCE_KINDS,
  DOM_MUTATION_SOURCE_LIMITS,
  type DomMutationSourceAction,
  type DomMutationSourceKind
} from '../../../../shared/dom-mutation-source.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import type { McpToolContext } from '../tool-context.js'

export function registerBrowserDomMutationSource(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_dom_mutation_source',
    {
      description: toolDescription('browser_dom_mutation_source'),
      inputSchema: {
        tabId: tabIdSchema,
        action: z.enum(DOM_MUTATION_SOURCE_ACTIONS).default('get'),
        selector: z.string().min(1).max(DOM_MUTATION_SOURCE_LIMITS.maxSelectorChars).optional()
          .describe('With arm: a CSS selector for exactly one element in the top-level document'),
        kind: z.enum(DOM_MUTATION_SOURCE_KINDS).optional()
          .describe('With arm: the change to capture on that element: attribute-modified, subtree-modified (children added or removed anywhere below it) or node-removed'),
        durationMs: z.number().int().min(DOM_MUTATION_SOURCE_LIMITS.minDurationMs).max(DOM_MUTATION_SOURCE_LIMITS.maxDurationMs).optional()
          .describe(`With arm: how long to wait for the change before it expires; default ${DOM_MUTATION_SOURCE_LIMITS.defaultDurationMs}`)
      }
    },
    tabTool('browser_dom_mutation_source', async ({ tabId, action, selector, kind, durationMs }: {
      tabId: string
      action: DomMutationSourceAction
      selector?: string
      kind?: DomMutationSourceKind
      durationMs?: number
    }, call) => {
      if (action !== 'arm' && (selector !== undefined || kind !== undefined || durationMs !== undefined)) {
        throw new Error('selector, kind and durationMs are only for action arm')
      }
      // Checked again while armed and before a capture is kept, without renewing the agent's write ownership.
      const authority = { assertCurrent: (origin: string) => call.validateLifecycle(origin) }
      return textResult(await manager.domMutationSourceAction(tabId, action, { selector, kind, durationMs, authority }))
    }),
    { readOnly: input => input.action === 'get' }
  )
}
