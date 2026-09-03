import { describe, expect, it, vi } from 'vitest'
import { McpActivityFollowController } from '../src/main/browser/mcp-activity-follow-controller.js'
import type { McpTabActivity } from '../src/shared/types.js'

function activity(
  activityId: string,
  tabId: string,
  phase: McpTabActivity['phase'] = 'started',
  occurredAt = Date.now()
): McpTabActivity {
  return { activityId, tabId, phase, occurredAt, toolName: 'browser_snapshot' }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((accept) => { resolve = accept })
  return { promise, resolve }
}

function createHarness() {
  let enabled = false
  let occluded = false
  let selectionGeneration = 0
  const tabs = new Set(['tab-a', 'tab-b'])
  const readyTabs = new Set(tabs)
  const wakeTab = vi.fn<(tabId: string) => Promise<void>>(async () => undefined)
  const selectTabPassively = vi.fn((tabId: string) => {
    selectionGeneration += 1
    return tabId
  })
  const onError = vi.fn()
  const controller = new McpActivityFollowController({
    isEnabled: () => enabled,
    isOccluded: () => occluded,
    getSelectionGeneration: () => selectionGeneration,
    tabExists: (tabId) => tabs.has(tabId),
    canSelectWithoutWake: (tabId) => readyTabs.has(tabId),
    wakeTab,
    selectTabPassively,
    onError
  })
  return {
    controller,
    wakeTab,
    selectTabPassively,
    onError,
    enable: () => { enabled = true; controller.refresh() },
    disable: () => { enabled = false; controller.refresh() },
    occlude: () => { occluded = true; controller.setOccluded(true) },
    reveal: () => { occluded = false; controller.setOccluded(false) },
    humanSelect: () => { selectionGeneration += 1 },
    requireWake: (tabId: string) => { readyTabs.delete(tabId) },
    removeTab: (tabId: string) => { tabs.delete(tabId); controller.removeTab(tabId) }
  }
}

describe('MCP activity follow controller', () => {
  it('does not wake or select activity targets while following is disabled', async () => {
    const harness = createHarness()

    harness.controller.accept(activity('one', 'tab-a'))
    await Promise.resolve()

    expect(harness.wakeTab).not.toHaveBeenCalled()
    expect(harness.selectTabPassively).not.toHaveBeenCalled()
  })

  it('passively follows the latest running activity and stays independent from input-lock state', async () => {
    const harness = createHarness()
    harness.enable()

    harness.controller.accept(activity('one', 'tab-a', 'started', 1))
    await vi.waitFor(() => expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-a'))
    harness.controller.accept(activity('two', 'tab-b', 'started', 2))
    await vi.waitFor(() => expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-b'))

    expect(harness.selectTabPassively).toHaveBeenCalledTimes(2)
  })

  it('does not miss an already-awake tab when activity starts and finishes back-to-back', async () => {
    const harness = createHarness()
    harness.enable()

    harness.controller.accept(activity('quick', 'tab-b', 'started', 1))
    harness.controller.accept(activity('quick', 'tab-b', 'finished', 1))
    await Promise.resolve()

    expect(harness.selectTabPassively).toHaveBeenCalledOnce()
    expect(harness.selectTabPassively).toHaveBeenCalledWith('tab-b')
  })

  it('defers under trusted chrome and follows only an activity that is still running when chrome closes', async () => {
    const harness = createHarness()
    harness.enable()
    harness.occlude()

    harness.controller.accept(activity('finished-under-modal', 'tab-a'))
    await Promise.resolve()
    expect(harness.wakeTab).not.toHaveBeenCalled()
    harness.controller.accept(activity('finished-under-modal', 'tab-a', 'finished'))
    harness.reveal()
    await Promise.resolve()
    expect(harness.selectTabPassively).not.toHaveBeenCalled()

    harness.occlude()
    harness.controller.accept(activity('still-running', 'tab-b'))
    harness.reveal()
    await vi.waitFor(() => expect(harness.selectTabPassively).toHaveBeenCalledWith('tab-b'))
  })

  it('does not override a newer human selection while a sleeping activity target wakes', async () => {
    const harness = createHarness()
    const wake = deferred()
    harness.wakeTab.mockImplementationOnce(() => wake.promise)
    harness.requireWake('tab-a')
    harness.enable()

    harness.controller.accept(activity('slow', 'tab-a'))
    await vi.waitFor(() => expect(harness.wakeTab).toHaveBeenCalledWith('tab-a'))
    harness.humanSelect()
    wake.resolve()
    await Promise.resolve()

    expect(harness.selectTabPassively).not.toHaveBeenCalled()
  })

  it('cancels pending follow work when disabled, occluded, or the target closes', async () => {
    for (const cancel of ['disable', 'occlude', 'remove'] as const) {
      const harness = createHarness()
      const wake = deferred()
      harness.wakeTab.mockImplementationOnce(() => wake.promise)
      harness.requireWake('tab-a')
      harness.enable()
      harness.controller.accept(activity(cancel, 'tab-a'))
      await vi.waitFor(() => expect(harness.wakeTab).toHaveBeenCalledWith('tab-a'))
      if (cancel === 'disable') harness.disable()
      else if (cancel === 'occlude') harness.occlude()
      else harness.removeTab('tab-a')
      wake.resolve()
      await Promise.resolve()
      expect(harness.selectTabPassively).not.toHaveBeenCalled()
    }
  })

  it('reports wake failures without leaking an unhandled rejection', async () => {
    const harness = createHarness()
    const failure = new Error('wake failed')
    harness.wakeTab.mockRejectedValueOnce(failure)
    harness.requireWake('tab-a')
    harness.enable()

    harness.controller.accept(activity('failure', 'tab-a'))

    await vi.waitFor(() => expect(harness.onError).toHaveBeenCalledWith(failure))
    expect(harness.selectTabPassively).not.toHaveBeenCalled()
  })
})
