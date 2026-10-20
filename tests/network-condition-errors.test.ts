import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import type { WebContents } from 'electron'
import { addNetworkRoute, moveNetworkRoute, removeNetworkRoute, setNetworkRouteEnabled } from '../src/main/browser/network-conditions/network-conditions.js'
import type { NetworkConditionsAccess, NetworkConditionsTab } from '../src/main/browser/network-conditions/network-conditions-access.js'
import { normalizeNetworkRouteInput } from '../src/main/browser/network-route-input.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { translate } from '../src/shared/i18n.js'

function conditions(routeCount = 0) {
  const debuggerEvents = Object.assign(new EventEmitter(), {
    sendCommand: async () => ({}),
    detach: () => undefined,
    isAttached: () => true
  })
  const contents = Object.assign(new EventEmitter(), { id: 7, debugger: debuggerEvents, isDestroyed: () => false }) as unknown as WebContents
  const tab: NetworkConditionsTab = {
    id: 'tab-1',
    url: 'https://app.test/page',
    webContents: contents,
    networkRoutes: Array.from({ length: routeCount }, (_, index) => ({
      ...normalizeNetworkRouteInput({ urlPattern: `https://app.test/never/${index}`, abort: 'Failed' }),
      id: `route-${index}`,
      createdAt: '2026-10-20T12:00:00.000Z'
    })),
    networkConditionApplication: 'confirmed',
    networkConditionEpoch: 0,
    networkDebuggerEpoch: 0,
    mainFrameId: 'main',
    emulation: { network: 'none' as never }
  }
  const access: NetworkConditionsAccess<NetworkConditionsTab> = {
    getTab: () => tab,
    findTab: id => id === tab.id ? tab : undefined,
    isDestroyed: () => false,
    withDebugger: async (_contents, operation, admission) => { admission?.(); return operation() },
    applyNetworkEmulation: async () => {},
    networkRouteQueues: () => new Map(),
    networkRouteRefreshTimers: () => new Map(),
    heldNetworkResponses: () => new Map(),
    changed: () => {}
  }
  return { access, tab }
}

async function failure(operation: Promise<unknown>): Promise<LocalizedError> {
  const error = await operation.then(() => undefined, (cause: unknown) => cause)
  expect(error).toBeInstanceOf(LocalizedError)
  return error as LocalizedError
}

// Request conditions showed these in English in every interface language, in the words agents read.
it('names a full tab for the Network panel and keeps the agent message', async () => {
  const { access, tab } = conditions(50)
  const error = await failure(addNetworkRoute(access, 'tab-1', { urlPattern: 'https://app.test/over-limit', abort: 'Failed' }))
  expect(error.key).toBe('appErrors.networkConditions.limitReached')
  expect(error.parameters).toEqual({ max: 50 })
  expect(error.message).toBe('Network route limit reached (50)')
  expect(translate('fr-FR', error.key, error.parameters)).toBe('Un onglet peut avoir au plus 50 conditions de requête. Supprimez-en une avant d’en ajouter une autre.')
  expect(tab.networkRoutes).toHaveLength(50)
})

it('names a condition removed meanwhile for the Network panel and keeps the agent message', async () => {
  const { access } = conditions(1)
  for (const change of [
    setNetworkRouteEnabled(access, 'tab-1', 'missing', false),
    removeNetworkRoute(access, 'tab-1', 'missing'),
    moveNetworkRoute(access, 'tab-1', 'missing', 'up')
  ]) {
    const error = await failure(change)
    expect(error.key).toBe('appErrors.networkConditions.conditionGone')
    expect(error.message).toBe('Network route not found: missing')
  }
})
