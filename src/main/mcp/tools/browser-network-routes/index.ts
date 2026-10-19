import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { BrowserNetworkAbortReason } from '../../../../shared/types.js'
import { HoldUnavailableError } from '../../../browser/network-conditions/held-responses.js'
import { networkRouteInputSchema } from '../../../browser/network-route-input.js'
import { textResult, toolDescription } from '../../tool-results.js'
import { tabIdSchema } from '../../tool-schemas.js'
import { type RequestConditionsSettlement, requestConditionsSettlement } from '../request-conditions-settlement.js'
import type { McpToolContext, WorkspaceToolCall } from '../tool-context.js'

export function registerBrowserNetworkRoutes(context: McpToolContext): void {
  const { manager, registerWorkspaceTool, tabTool } = context
  registerWorkspaceTool(
    'browser_network_routes',
    {
      description: toolDescription('browser_network_routes'),
      inputSchema: {
        action: z.enum(['list', 'add', 'move', 'remove', 'clear', 'set-enabled', 'held', 'release', 'cancel']).optional()
          .describe('held lists requests that hold rules captured; release answers one with its mock response, cancel fails it. Both take the routeId of the hold rule.'),
        tabId: tabIdSchema.optional(),
        routeId: z.string().optional(),
        enabled: z.boolean().optional().describe('Explicit enabled state; required with routeId for set-enabled. Only confirmed conditions can be toggled.'),
        direction: z.enum(['up', 'down']).optional()
          .describe('Move a first-match-wins condition one position up or down. Requires action move and routeId.'),
        urlPattern: networkRouteInputSchema.shape.urlPattern.optional(),
        method: networkRouteInputSchema.shape.method,
        times: networkRouteInputSchema.shape.times,
        response: networkRouteInputSchema.shape.response,
        abort: networkRouteInputSchema.shape.abort,
        throttle: networkRouteInputSchema.shape.throttle
          .describe('Throttle only matching URLs until the condition is removed. Cannot be combined with method or times.'),
        holdUntilReleased: networkRouteInputSchema.shape.holdUntilReleased
          .describe('With response: capture one same-origin GET fetch or XMLHttpRequest from the top frame and keep it pending, so the page stays in its loading state, until action release answers it with the mock response or action cancel fails it.'),
        holdSeconds: networkRouteInputSchema.shape.holdSeconds
          .describe('Seconds a captured request waits for release before it fails (default 30, at most 120).')
      }
    },
    tabTool('browser_network_routes', async ({
      action = 'list',
      tabId,
      routeId,
      direction,
      enabled,
      urlPattern,
      method,
      times,
      response,
      abort,
      throttle,
      holdUntilReleased,
      holdSeconds
    }: {
      action?: 'list' | 'add' | 'move' | 'remove' | 'clear' | 'set-enabled' | 'held' | 'release' | 'cancel'
      tabId?: string
      routeId?: string
      enabled?: boolean
      direction?: 'up' | 'down'
      urlPattern?: string
      method?: string
      times?: number
      response?: { status?: number; headers?: Record<string, string>; body?: string }
      abort?: BrowserNetworkAbortReason
      throttle?: 'fast-4g' | 'slow-4g' | 'slow-3g'
      holdUntilReleased?: boolean
      holdSeconds?: number
    }, call: WorkspaceToolCall<RequestConditionsSettlement>) => {
      // Checks the call before each configuration step, and keeps the check for publication.
      const validateConditions = (): void => {
        const assert = (): void => {
          if (call.signal?.aborted) throw new Error('Request-condition operation cancelled')
          call.requireCurrentTarget()
          call.requirePostWriteContext()
          if (call.authorityRejection()) throw new Error('Request-condition authority changed')
        }
        assert()
        call.settlement.retainPublication(assert)
      }
      const markConditionsSubmitted = call.settlement.markSubmitted
      validateConditions()
      const publish = (routes: import('../../../../shared/types.js').BrowserNetworkRouteSummary[]): CallToolResult => {
        const assert = manager.networkConditionPublication(tabId, routes)
        call.settlement.retainPublication(() => { validateConditions(); assert() })
        return textResult(routes)
      }
      // Holds answer one captured request; their failures are not rule application failures.
      if (action === 'held') return textResult(manager.heldNetworkResponses(tabId))
      if (action === 'release' || action === 'cancel') {
        if (!routeId) throw new Error(`routeId is required to ${action} a held request`)
        try {
          if (action === 'release') await manager.releaseHeldNetworkResponse(tabId, routeId, validateConditions, markConditionsSubmitted)
          else await manager.cancelHeldNetworkResponse(tabId, routeId, validateConditions, markConditionsSubmitted)
        } catch (error) {
          if (!(error instanceof HoldUnavailableError)) throw error
          const refused = { reason: error.reason, message: error.message, routeId, nextAction: error.nextAction }
          return { ...textResult(refused), structuredContent: refused, isError: true }
        }
        validateConditions()
        return textResult({ status: action === 'release' ? 'RELEASED' : 'CANCELLED', routeId })
      }
      try {
        if (action === 'list') return publish(manager.networkRoutes(tabId))
        if (action === 'clear') return publish(await manager.clearNetworkRoutes(tabId, validateConditions, markConditionsSubmitted))
        if (action === 'set-enabled') {
          if (!routeId || typeof enabled !== 'boolean') throw new Error('routeId and boolean enabled are required for set-enabled')
          return publish(await manager.setNetworkRouteEnabled(tabId, routeId, enabled, validateConditions, markConditionsSubmitted))
        }
        if (action === 'move') {
          if (!routeId || !direction) throw new Error('routeId and direction are required when moving a network route')
          return publish(await manager.moveNetworkRoute(tabId, routeId, direction, validateConditions, markConditionsSubmitted))
        }
        if (action === 'remove') {
          if (!routeId) throw new Error('routeId is required when removing a network route')
          return publish(await manager.removeNetworkRoute(tabId, routeId, validateConditions, markConditionsSubmitted))
        }
        if (!urlPattern) throw new Error('urlPattern is required when adding a network route')
        return publish(await manager.addNetworkRoute(tabId, { urlPattern, method, times, response, abort, throttle, holdUntilReleased, holdSeconds }, validateConditions, markConditionsSubmitted))
      } catch (error) {
        validateConditions()
        const state = manager.networkConditionState(tabId)
        if (state.application === 'confirmed') throw error
        // Clearing would fail a held request, so an agent holding one is pointed at its hold instead.
        const holding = manager.heldNetworkResponses(tabId).length > 0
        const outcome = { status: 'NETWORK_CONDITIONS_UNCONFIRMED', ...state, retrySafe: false,
          nextAction: holding
            ? 'A request is held: use action held, release or cancel for it, and retry this action shortly if application is pending. Clearing conditions fails held requests.'
            : 'Explicitly clear conditions to recover. Future matching requests may reach their normal destination. Already-dispatched effects cannot be undone.' }
        return { ...textResult(outcome), structuredContent: outcome, isError: true }
      }
    }),
    { settlement: input => requestConditionsSettlement(false, input, input.action === 'list' || input.action === 'held') }
  )
}
