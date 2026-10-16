import { describe, expect, it, vi } from 'vitest'
import { AGENT_FOLLOW_HOLD_MS, AGENT_FOLLOW_HUMAN_PAUSE_MS, McpActivityFollowController } from '../src/main/browser/mcp-activity-follow-controller.js'
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
  const tabs = new Set(['tab-a', 'tab-b', 'tab-c'])
  const readyTabs = new Set(tabs)
  const wakeTab = vi.fn<(tabId: string) => Promise<void>>(async () => undefined)
  const selectTabPassively = vi.fn((tabId: string) => {
    selectionGeneration += 1
    return tabId
  })
  const onError = vi.fn()
  const onFollow = vi.fn()
  const controller = new McpActivityFollowController({
    isEnabled: () => enabled,
    isOccluded: () => occluded,
    getSelectionGeneration: () => selectionGeneration,
    tabExists: (tabId) => tabs.has(tabId),
    canSelectWithoutWake: (tabId) => readyTabs.has(tabId),
    wakeTab,
    selectTabPassively,
    onFollow,
    onError
  })
  return {
    controller,
    onFollow,
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
  it('never wakes or selects a React inspection target even while following is enabled', async () => {
    const harness = createHarness()
    harness.requireWake('tab-a')
    harness.enable()
    harness.controller.accept({ ...activity('react', 'tab-a'), toolName: 'browser_react' })
    harness.controller.refresh()
    harness.controller.accept({ ...activity('react', 'tab-a', 'finished'), toolName: 'browser_react' })
    await Promise.resolve()
    expect(harness.wakeTab).not.toHaveBeenCalled()
    expect(harness.selectTabPassively).not.toHaveBeenCalled()
    harness.controller.dispose()
  })

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

  it('does not resume abandoned activities outside the latest 40 dispatches', () => {
    const harness = createHarness()
    try {
      for (let index = 0; index < 100; index += 1) {
        harness.controller.accept(activity(`call-${index}`, index < 60 ? 'tab-a' : 'tab-b'))
      }
      harness.enable()
      expect(harness.selectTabPassively).toHaveBeenCalledWith('tab-b')

      for (let index = 99; index >= 60; index -= 1) {
        harness.controller.accept(activity(`call-${index}`, 'tab-b', 'finished'))
      }
      expect(harness.selectTabPassively).toHaveBeenCalledTimes(40)
      expect(harness.selectTabPassively.mock.calls.every(([tabId]) => tabId === 'tab-b')).toBe(true)
      harness.controller.refresh()
      expect(harness.selectTabPassively).toHaveBeenCalledTimes(40)

      harness.controller.accept(activity('fresh', 'tab-a'))
      expect(harness.selectTabPassively).toHaveBeenCalledTimes(41)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-a')
    } finally {
      harness.controller.dispose()
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


it('never wakes or follows video controls, including after toggling Follow agent', () => {
  const harness = createHarness()
  harness.requireWake('tab-a')
  harness.enable()
  harness.controller.accept({ ...activity('video', 'tab-a'), toolName: 'browser_video' })
  harness.disable(); harness.enable()
  harness.controller.accept({ ...activity('video', 'tab-a', 'finished'), toolName: 'browser_video' })
  expect(harness.wakeTab).not.toHaveBeenCalled()
  expect(harness.selectTabPassively).not.toHaveBeenCalled()
  harness.controller.accept(activity('normal', 'tab-b'))
  expect(harness.selectTabPassively).toHaveBeenCalledWith('tab-b')
})

describe('following agents across workspaces', () => {
  const claude = { id: 'session-1', name: 'Claude Code' }
  const codex = { id: 'session-2', name: 'Codex' }
  /** The tab in view: following selects the tab of the call it shows, again on each call. */
  const shown = (harness: ReturnType<typeof createHarness>) => harness.selectTabPassively.mock.calls.at(-1)?.[0]

  it('stays with the agent it shows while it works, then moves to another agent still running', () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      harness.enable()
      // tab-a and tab-b stand for tabs in two workspaces; following does not look at workspaces.
      harness.controller.accept(activity('claude-1', 'tab-a'), claude)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-a')
      expect(harness.onFollow).toHaveBeenLastCalledWith({ tabId: 'tab-a', agent: claude })
      vi.advanceTimersByTime(1_000)
      // Another agent's call does not take the view while the first keeps working.
      harness.controller.accept(activity('codex-1', 'tab-b'), codex)
      expect(shown(harness)).toBe('tab-a')
      harness.controller.accept(activity('claude-1', 'tab-a', 'finished'), claude)
      vi.advanceTimersByTime(AGENT_FOLLOW_HOLD_MS - 1_000)
      harness.controller.accept(activity('claude-2', 'tab-c'), claude)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-c')
      harness.controller.accept(activity('claude-2', 'tab-c', 'finished'), claude)
      vi.advanceTimersByTime(AGENT_FOLLOW_HOLD_MS - 1)
      expect(shown(harness)).toBe('tab-c')
      // Quiet for the hold: the other agent's running call takes the view, and following holds on it.
      vi.advanceTimersByTime(2)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-b')
      expect(harness.onFollow).toHaveBeenLastCalledWith({ tabId: 'tab-b', agent: codex })
      harness.controller.accept(activity('claude-3', 'tab-a'), claude)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-b')
      harness.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits while the person types, clicks or scrolls, and moves only with the next call after that', () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      harness.enable()
      harness.controller.accept(activity('claude-1', 'tab-a'), claude)
      harness.controller.accept(activity('claude-1', 'tab-a', 'finished'), claude)
      expect(shown(harness)).toBe('tab-a')
      harness.controller.noteHumanInput()
      harness.controller.accept(activity('claude-2', 'tab-b'), claude)
      vi.advanceTimersByTime(AGENT_FOLLOW_HUMAN_PAUSE_MS - 1)
      harness.controller.accept(activity('claude-3', 'tab-b'), claude)
      expect(shown(harness)).toBe('tab-a')
      // The pause ending does not move the view by itself.
      vi.advanceTimersByTime(AGENT_FOLLOW_HOLD_MS + 1)
      expect(shown(harness)).toBe('tab-a')
      harness.controller.accept(activity('claude-4', 'tab-b'), claude)
      expect(harness.selectTabPassively).toHaveBeenLastCalledWith('tab-b')
      harness.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets another agent in when the call it shows never finishes', () => {
    vi.useFakeTimers()
    try {
      const harness = createHarness()
      harness.enable()
      harness.controller.accept(activity('claude-wait', 'tab-a'), claude)
      expect(shown(harness)).toBe('tab-a')
      // Codex's quick calls re-select the call still running, which must not renew Claude Code's hold.
      for (let call = 0; call < 3; call += 1) {
        vi.advanceTimersByTime(2_000)
        harness.controller.accept(activity(`codex-${call}`, 'tab-b'), codex)
        harness.controller.accept(activity(`codex-${call}`, 'tab-b', 'finished'), codex)
      }
      expect(harness.onFollow).toHaveBeenCalledWith({ tabId: 'tab-b', agent: codex })
      // Once Codex is quiet, the call still running is shown again, but holds the view no longer.
      vi.advanceTimersByTime(AGENT_FOLLOW_HOLD_MS + 1)
      expect(shown(harness)).toBe('tab-a')
      harness.controller.accept(activity('codex-next', 'tab-b'), codex)
      expect(shown(harness)).toBe('tab-b')
      harness.controller.dispose()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a wake under way when the person starts typing', async () => {
    const harness = createHarness()
    const wake = deferred()
    harness.wakeTab.mockImplementationOnce(() => wake.promise)
    harness.requireWake('tab-a')
    harness.enable()
    harness.controller.accept(activity('slow', 'tab-a'), claude)
    await vi.waitFor(() => expect(harness.wakeTab).toHaveBeenCalledWith('tab-a'))
    harness.controller.noteHumanInput()
    wake.resolve()
    await Promise.resolve()
    expect(harness.selectTabPassively).not.toHaveBeenCalled()
    expect(harness.onFollow).not.toHaveBeenCalled()
  })
})
