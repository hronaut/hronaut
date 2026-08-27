import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePanelWindowEventsController } from '../../src/renderer/src/composables/usePanelWindowEventsController.js'
import type {
  HronautPanelWindowApi,
  DetachablePanelId,
  PanelRedockRequest
} from '../../src/shared/types.js'

type PanelListeners = {
  requested?: (panel: DetachablePanelId) => void
  active?: (panel: DetachablePanelId) => void
  redock?: (request: PanelRedockRequest) => void
  closed?: () => void
}

function createHarness(detachedWindow: boolean) {
  const listeners: PanelListeners = {}
  const unsubscribers = Array.from({ length: 4 }, () => vi.fn())
  const api = {
    onPanelRequested: vi.fn((listener: NonNullable<PanelListeners['requested']>) => {
      listeners.requested = listener
      return unsubscribers[0]
    }),
    onActivePanelChanged: vi.fn((listener: NonNullable<PanelListeners['active']>) => {
      listeners.active = listener
      return unsubscribers[1]
    }),
    onRedockRequested: vi.fn((listener: NonNullable<PanelListeners['redock']>) => {
      listeners.redock = listener
      return unsubscribers[2]
    }),
    onClosed: vi.fn((listener: NonNullable<PanelListeners['closed']>) => {
      listeners.closed = listener
      return unsubscribers[3]
    })
  } satisfies Pick<
    HronautPanelWindowApi,
    'onPanelRequested' | 'onActivePanelChanged' | 'onRedockRequested' | 'onClosed'
  >
  const callbacks = {
    showDetachedPanel: vi.fn(),
    activateMainPanel: vi.fn(),
    redockMainPanel: vi.fn(),
    closeMainPanels: vi.fn(),
    onError: vi.fn()
  }
  const controller = usePanelWindowEventsController({ api, detachedWindow, ...callbacks })
  return { api, callbacks, controller, listeners, unsubscribers }
}

describe('panel window events controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('subscribes immediately and routes panel requests only to detached windows', () => {
    const detached = createHarness(true)
    expect(detached.api.onPanelRequested).toHaveBeenCalledOnce()
    expect(detached.api.onActivePanelChanged).toHaveBeenCalledOnce()
    expect(detached.api.onRedockRequested).toHaveBeenCalledOnce()
    expect(detached.api.onClosed).toHaveBeenCalledOnce()

    detached.listeners.requested?.('network')
    detached.listeners.active?.('console')
    detached.listeners.redock?.({ panel: 'network', dock: 'right' })
    detached.listeners.closed?.()

    expect(detached.callbacks.showDetachedPanel).toHaveBeenCalledWith('network')
    expect(detached.callbacks.activateMainPanel).not.toHaveBeenCalled()
    expect(detached.callbacks.redockMainPanel).not.toHaveBeenCalled()
    expect(detached.callbacks.closeMainPanels).not.toHaveBeenCalled()
    detached.controller.dispose()
  })

  it('routes detached-window state back to the main shell without reopening it', async () => {
    const main = createHarness(false)
    main.listeners.requested?.('network')
    main.listeners.active?.('console')
    main.listeners.active?.('network')
    main.listeners.redock?.({ panel: 'network', dock: 'left' })
    main.listeners.closed?.()

    expect(main.callbacks.showDetachedPanel).not.toHaveBeenCalled()
    expect(main.callbacks.activateMainPanel).toHaveBeenNthCalledWith(1, 'console')
    expect(main.callbacks.activateMainPanel).toHaveBeenNthCalledWith(2, 'network')
    expect(main.callbacks.redockMainPanel).toHaveBeenCalledWith({ panel: 'network', dock: 'left' })
    expect(main.callbacks.closeMainPanels).toHaveBeenCalledOnce()
    expect(main.controller.syncingMainPanelState.value).toBe(true)

    await vi.runOnlyPendingTimersAsync()
    expect(main.controller.syncingMainPanelState.value).toBe(false)
    main.controller.dispose()
  })

  it('disposes idempotently, clears pending state, and ignores late events', () => {
    const main = createHarness(false)
    main.listeners.active?.('console')
    expect(main.controller.syncingMainPanelState.value).toBe(true)

    main.controller.dispose()
    main.controller.dispose()
    expect(main.controller.syncingMainPanelState.value).toBe(false)
    expect(main.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)

    main.listeners.active?.('network')
    main.listeners.redock?.({ panel: 'network', dock: 'bottom' })
    main.listeners.closed?.()
    expect(main.callbacks.activateMainPanel).toHaveBeenCalledOnce()
    expect(main.callbacks.redockMainPanel).not.toHaveBeenCalled()
    expect(main.callbacks.closeMainPanels).not.toHaveBeenCalled()
  })

  it('contains rejected detached-panel refreshes and reports them while mounted', async () => {
    const detached = createHarness(true)
    const failure = new Error('panel renderer unavailable')
    detached.callbacks.showDetachedPanel.mockRejectedValueOnce(failure)

    detached.listeners.requested?.('network')
    await vi.waitFor(() => expect(detached.callbacks.onError).toHaveBeenCalledWith(failure))

    detached.controller.dispose()
  })

  it('unsubscribes every panel event and clears pending state when one unsubscriber throws', () => {
    const main = createHarness(false)
    const failure = new Error('panel event bridge unavailable')
    main.listeners.active?.('console')
    main.unsubscribers[0].mockImplementationOnce(() => { throw failure })

    expect(main.controller.dispose).toThrow(failure)
    expect(main.unsubscribers.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true)
    expect(main.controller.syncingMainPanelState.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
