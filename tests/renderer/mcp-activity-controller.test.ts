import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMcpActivityController } from '../../src/renderer/src/composables/useMcpActivityController.js'
import type { McpTabActivity } from '../../src/shared/types.js'

function activity(
  activityId: string,
  phase: McpTabActivity['phase'],
  tabId = 'tab-1',
  toolName = 'browser_wait'
): McpTabActivity {
  return { activityId, phase, tabId, toolName, occurredAt: Date.now() }
}

function createController(hydratedInitially = true) {
  const tabIds = ref<readonly string[]>(hydratedInitially ? ['tab-1', 'tab-2'] : [])
  const hydrated = ref(hydratedInitially)
  const unsubscribe = vi.fn()
  let listener: ((next: McpTabActivity) => void) | undefined
  const onMcpTabActivity = vi.fn((next: (activity: McpTabActivity) => void) => {
    listener = next
    return unsubscribe
  })
  const controller = useMcpActivityController({
    api: { onMcpTabActivity },
    tabIds,
    hydrated,
    lingerMs: 100
  })
  return {
    tabIds,
    hydrated,
    listener: (next: McpTabActivity) => listener?.(next),
    onMcpTabActivity,
    unsubscribe,
    controller
  }
}

describe('MCP activity controller', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('subscribes immediately and preserves startup activity through browser-state hydration', async () => {
    const harness = createController(false)
    expect(harness.onMcpTabActivity).toHaveBeenCalledOnce()

    harness.listener(activity('early', 'started'))
    expect(harness.controller.activityByTab.value['tab-1']?.activityId).toBe('early')

    harness.tabIds.value = ['tab-1']
    harness.hydrated.value = true
    await nextTick()
    expect(harness.controller.activityByTab.value['tab-1']?.activityId).toBe('early')
    harness.controller.dispose()
  })

  it('keeps the latest overlapping command visible and clears it after the final linger', async () => {
    const harness = createController()
    harness.listener(activity('first', 'started', 'tab-1', 'browser_wait'))
    harness.listener(activity('second', 'started', 'tab-1', 'browser_evaluate'))
    expect(harness.controller.activityByTab.value['tab-1']?.toolName).toBe('browser_evaluate')

    harness.listener(activity('second', 'finished', 'tab-1', 'browser_evaluate'))
    expect(harness.controller.activityByTab.value['tab-1']?.toolName).toBe('browser_wait')
    await vi.advanceTimersByTimeAsync(100)
    expect(harness.controller.activityByTab.value['tab-1']?.toolName).toBe('browser_wait')

    harness.listener(activity('first', 'failed', 'tab-1', 'browser_wait'))
    await vi.advanceTimersByTimeAsync(99)
    expect(harness.controller.activityByTab.value['tab-1']).toBeDefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(harness.controller.activityByTab.value['tab-1']).toBeUndefined()
    harness.controller.dispose()
  })

  it('ignores completion events that have no matching start instead of extending stale feedback', async () => {
    const harness = createController()
    harness.listener(activity('known', 'started'))
    harness.listener(activity('known', 'finished'))
    await vi.advanceTimersByTimeAsync(90)

    harness.listener(activity('unknown', 'finished'))
    await vi.advanceTimersByTimeAsync(10)
    expect(harness.controller.activityByTab.value['tab-1']).toBeUndefined()
    harness.controller.dispose()
  })

  it('prunes active and lingering activity as soon as a hydrated tab disappears', async () => {
    const harness = createController()
    harness.listener(activity('active', 'started', 'tab-1'))
    harness.listener(activity('linger', 'started', 'tab-2'))
    harness.listener(activity('linger', 'finished', 'tab-2'))

    harness.tabIds.value = []
    await nextTick()
    expect(harness.controller.activityByTab.value).toEqual({})

    await vi.advanceTimersByTimeAsync(100)
    expect(harness.controller.activityByTab.value).toEqual({})
    harness.controller.dispose()
  })

  it('unsubscribes once and ignores events delivered after disposal', () => {
    const harness = createController()
    harness.controller.dispose()
    harness.controller.dispose()
    harness.listener(activity('late', 'started'))

    expect(harness.unsubscribe).toHaveBeenCalledOnce()
    expect(harness.controller.activityByTab.value).toEqual({})
  })

  it('rolls back the native activity listener when tab tracking setup fails', () => {
    const setupError = new Error('tab ids unavailable')
    const unsubscribe = vi.fn()
    const onMcpTabActivity = vi.fn(() => unsubscribe)
    const tabIds = ref<readonly string[]>([])
    Object.defineProperty(tabIds, 'value', {
      configurable: true,
      get() {
        throw setupError
      }
    })

    expect(() => useMcpActivityController({
      api: { onMcpTabActivity },
      tabIds,
      hydrated: ref(true),
      lingerMs: 100
    })).toThrow(setupError)

    expect(onMcpTabActivity).toHaveBeenCalledOnce()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('clears every activity resource when the native unsubscriber throws', () => {
    const harness = createController()
    harness.listener(activity('lingering', 'started'))
    harness.listener(activity('lingering', 'finished'))
    expect(vi.getTimerCount()).toBe(1)
    expect(harness.controller.activityByTab.value['tab-1']).toBeDefined()
    harness.unsubscribe.mockImplementationOnce(() => {
      throw new Error('activity listener already closed')
    })

    expect(() => harness.controller.dispose()).toThrow('activity listener already closed')

    expect(vi.getTimerCount()).toBe(0)
    expect(harness.controller.activityByTab.value).toEqual({})
  })
})
