import { nextTick, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useConsoleController } from '../../src/renderer/src/composables/useConsoleController.js'
import type { BrowserConsoleMessage, BrowserTabState } from '../../src/shared/types.js'

function tab(id = 'tab-1'): BrowserTabState {
  return {
    id,
    title: 'Example',
    url: 'https://example.test/app',
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active: true,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false
  }
}

function message(text: string): BrowserConsoleMessage {
  return {
    timestamp: '2026-08-21T12:00:00.000Z',
    level: 'error',
    message: text,
    lineNumber: 12,
    sourceId: 'https://example.test/app.js'
  }
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: Error) => void
  const promise = new Promise<Value>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const open = ref(false)
  const browser = {
    listConsoleMessages: vi.fn(async () => [] as BrowserConsoleMessage[])
  }
  const copyText = vi.fn(async (_text: string) => true)
  const controller = useConsoleController({
    activeTab,
    open,
    browser,
    translate: (key) => key,
    copyText,
    keepsSeparatePanelOpen: () => false
  })
  return { activeTab, open, browser, controller, copyText }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('console controller', () => {
  it('keeps filtered event counts and clipboard aligned without removing excluded records', async () => {
    const { controller, copyText } = createController()
    controller.messages.value = [message('failure'), { ...message('heartbeat'), repeatCount: 4 }]
    try {
      controller.excludeText.value = 'heartbeat'
      expect(controller.filteredEventCount.value).toBe(1)
      expect(controller.eventCount.value).toBe(5)
      expect(controller.messageCounts.value.error).toBe(5)
      await controller.copyFiltered()
      expect(JSON.parse(copyText.mock.calls.at(-1)![0])).toMatchObject({
        filter: { excludeText: 'heartbeat' }, messages: [{ message: 'failure' }]
      })
      await controller.copyAll()
      expect(JSON.parse(copyText.mock.calls.at(-1)![0])).toMatchObject({
        messages: [{ message: 'heartbeat', repeatCount: 4 }, { message: 'failure' }]
      })
      controller.excludeText.value = ''
      expect(controller.filteredEventCount.value).toBe(5)
    } finally { controller.dispose() }
  })

  it.each(['search', 'level', 'excludeText'] as const)('clears filtered copy feedback when %s changes, including a late clipboard result', async (filter) => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.messages.value = [message('first'), { ...message('second'), level: 'warning' }]
    const changeFilter = () => {
      if (filter === 'search') controller.search.value = 'first'
      else if (filter === 'excludeText') controller.excludeText.value = 'second'
      else controller.level.value = 'error'
    }
    const resetFilter = () => {
      if (filter === 'search') controller.search.value = ''
      else if (filter === 'excludeText') controller.excludeText.value = ''
      else controller.level.value = 'all'
    }
    try {
      await controller.copyFiltered()
      expect(controller.copied.value).toBe('filtered')
      changeFilter()
      expect(controller.copied.value).toBeNull()
      resetFilter()
      copyText.mockReturnValueOnce(pending.promise)
      const copying = controller.copyFiltered()
      changeFilter()
      resetFilter()
      pending.resolve(true)
      await copying
      expect(controller.copied.value).toBeNull()
      changeFilter()
      await controller.copyFiltered()
      expect(controller.copied.value).toBe('filtered')
      expect(JSON.parse(copyText.mock.calls.at(-1)![0])).toMatchObject({ messages: [{ message: 'first' }] })
      await controller.copyAll()
      resetFilter()
      expect(controller.copied.value).toBe('all')
    } finally { controller.dispose() }
  })

  it.each(['entry', 'filtered', 'all'] as const)('invalidates a pending %s copy when the console is cleared', async (scope) => {
    const pending = deferred<boolean>()
    const { controller, copyText } = createController()
    const oldMessage = message('before clear')
    controller.messages.value = [oldMessage]
    copyText.mockReturnValueOnce(pending.promise)
    const copy = () => scope === 'entry'
      ? controller.copyEntry(controller.messages.value[0])
      : scope === 'filtered' ? controller.copyFiltered() : controller.copyAll()
    try {
      const operation = copy()
      await controller.refresh(true)
      expect(controller.messages.value).toEqual([])
      pending.resolve(true)
      await operation
      expect(controller.copied.value).toBeNull()
      expect(controller.copiedEntryKey.value).toBeNull()

      controller.messages.value = [message('after clear')]
      await copy()
      if (scope === 'entry') expect(controller.copiedEntryKey.value).toContain('after clear')
      else expect(controller.copied.value).toBe(scope)
      expect(JSON.parse(copyText.mock.calls.at(-1)![0])).toMatchObject({ messages: [{ message: 'after clear' }] })
    } finally { controller.dispose() }
  })

  it('invalidates a copy started while Clear is pending', async () => {
    const clearing = deferred<BrowserConsoleMessage[]>()
    const copying = deferred<boolean>()
    const { controller, browser, copyText } = createController()
    controller.messages.value = [message('old messages')]
    browser.listConsoleMessages.mockReturnValueOnce(clearing.promise)
    copyText.mockReturnValueOnce(copying.promise)
    try {
      const clear = controller.refresh(true)
      const copy = controller.copyAll()
      clearing.resolve([])
      await clear
      copying.resolve(true)
      await copy
      expect(controller.copied.value).toBeNull()
    } finally { controller.dispose() }
  })

  it.each(['resolved', 'rejected'] as const)('waits for a slow read to be %s before polling again', async (outcome) => {
    vi.useFakeTimers()
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller, open } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)
    try {
      open.value = true
      await nextTick()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(1)

      if (outcome === 'resolved') pending.resolve([message('slow response')])
      else pending.reject(new Error('Read failed'))
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.state.value).toBe(outcome === 'resolved' ? 'ready' : 'error')
      if (outcome === 'resolved') expect(controller.messages.value).toEqual([message('slow response')])

      browser.listConsoleMessages.mockResolvedValueOnce([message('next response')])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      expect(controller.messages.value).toEqual([message('next response')])
      expect(controller.state.value).toBe('ready')
    } finally { controller.dispose() }
  })

  it.each(['resolved', 'rejected'] as const)('freezes displayed rows when an older automatic read is %s, then resumes immediately', async (outcome) => {
    vi.useFakeTimers()
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller, open } = createController()
    browser.listConsoleMessages.mockResolvedValueOnce([message('first')]).mockReturnValueOnce(pending.promise)
    try {
      open.value = true
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      controller.search.value = 'first'
      controller.excludeText.value = 'noise'
      controller.level.value = 'error'
      controller.toggleLiveUpdates()
      await vi.advanceTimersByTimeAsync(3_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      if (outcome === 'resolved') pending.resolve([message('stale')])
      else pending.reject(new Error('stale error'))
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.messages.value).toEqual([message('first')])
      expect(controller.error.value).toBe('')
      expect(controller.state.value).toBe('ready')
      browser.listConsoleMessages.mockResolvedValueOnce([message('first fresh')])
      controller.toggleLiveUpdates()
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(3)
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.filteredMessages.value).toEqual([message('first fresh')])
      expect(controller.excludeText.value).toBe('noise')
      expect(controller.level.value).toBe('error')
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(4)
    } finally { controller.dispose() }
  })

  it('allows one explicit read or Clear while paused and discloses the frozen copy scope', async () => {
    vi.useFakeTimers()
    const { browser, controller, open, copyText } = createController()
    browser.listConsoleMessages.mockResolvedValueOnce([message('keep'), message('noise')])
    try {
      open.value = true
      await vi.advanceTimersByTimeAsync(0)
      controller.toggleLiveUpdates()
      controller.excludeText.value = 'noise'
      await controller.copyFiltered()
      expect(JSON.parse(copyText.mock.calls.at(-1)![0])).toMatchObject({
        displayUpdatesPaused: true, pendingMessages: 'unknown', missedMessages: 'unknown',
        messages: [{ message: 'keep' }]
      })
      await controller.copyAll()
      expect((JSON.parse(copyText.mock.calls.at(-1)![0]) as { messages: BrowserConsoleMessage[] }).messages).toHaveLength(2)
      browser.listConsoleMessages.mockResolvedValueOnce([message('new retained')])
      await controller.refresh()
      expect(controller.messages.value).toEqual([message('new retained')])
      expect(controller.liveUpdatesPaused.value).toBe(true)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      await controller.refresh(true)
      expect(browser.listConsoleMessages).toHaveBeenLastCalledWith('tab-1', true)
      expect(controller.messages.value).toEqual([])
      expect(controller.liveUpdatesPaused.value).toBe(true)
      expect(controller.excludeText.value).toBe('noise')
    } finally { controller.dispose() }
  })

  it.each(['close', 'reset'] as const)('resets pause on %s without stranding a pending manual refresh or accepting its old result', async (action) => {
    vi.useFakeTimers()
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller, open } = createController()
    browser.listConsoleMessages.mockResolvedValueOnce([message('first')])
    try {
      open.value = true
      await vi.advanceTimersByTimeAsync(0)
      controller.toggleLiveUpdates()
      browser.listConsoleMessages.mockReturnValueOnce(pending.promise)
      const read = controller.refresh()
      controller.toggleLiveUpdates()
      expect(controller.liveUpdatesPaused.value).toBe(true)
      browser.listConsoleMessages.mockResolvedValueOnce([message('new session')])
      if (action === 'close') {
        open.value = false
        open.value = true
      } else controller.reset()
      expect(controller.liveUpdatesPaused.value).toBe(false)
      await vi.advanceTimersByTimeAsync(action === 'close' ? 0 : 1_000)
      expect(controller.messages.value).toEqual([message('new session')])
      expect(controller.state.value).toBe('ready')
      pending.resolve([message('old session')])
      await read
      expect(controller.messages.value).toEqual([message('new session')])
    } finally { controller.dispose() }
  })

  it('allows Clear to supersede a pending poll without an older read releasing its guard', async () => {
    vi.useFakeTimers()
    const older = deferred<BrowserConsoleMessage[]>()
    const clearing = deferred<BrowserConsoleMessage[]>()
    const { browser, controller, open } = createController()
    browser.listConsoleMessages
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => clearing.promise)
    try {
      open.value = true
      await nextTick()
      const operation = controller.refresh(true)
      expect(browser.listConsoleMessages).toHaveBeenLastCalledWith('tab-1', true)
      older.resolve([message('before clear')])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      expect(controller.messages.value).toEqual([])

      clearing.resolve([])
      await operation
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(3)
      expect(controller.state.value).toBe('ready')
    } finally { controller.dispose() }
  })

  it('invalidates an in-flight refresh when reset on the same tab', async () => {
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)

    const loading = controller.refresh()
    controller.reset()
    pending.resolve([message('stale')])
    await loading

    expect(controller.messages.value).toEqual([])
    expect(controller.state.value).toBe('idle')
    controller.dispose()
  })

  it('does not let a pending read block polling after the console context resets', async () => {
    vi.useFakeTimers()
    const pending = deferred<BrowserConsoleMessage[]>()
    const { browser, controller, open } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)
    try {
      open.value = true
      await nextTick()
      controller.reset()
      browser.listConsoleMessages.mockResolvedValueOnce([message('new context')])
      await vi.advanceTimersByTimeAsync(1_000)
      expect(browser.listConsoleMessages).toHaveBeenCalledTimes(2)
      expect(controller.messages.value).toEqual([message('new context')])
      pending.resolve([message('old context')])
      await vi.advanceTimersByTimeAsync(0)
      expect(controller.messages.value).toEqual([message('new context')])
    } finally { controller.dispose() }
  })

  it('ignores a response from the previously active tab', async () => {
    const pending = deferred<BrowserConsoleMessage[]>()
    const { activeTab, browser, controller } = createController()
    browser.listConsoleMessages.mockImplementationOnce(() => pending.promise)

    const loading = controller.refresh()
    activeTab.value = tab('tab-2')
    pending.resolve([message('old tab')])
    await loading

    expect(controller.messages.value).toEqual([])
    expect(controller.state.value).toBe('loading')
    controller.dispose()
  })

  it('restarts copied feedback when the same console scope is copied again', async () => {
    vi.useFakeTimers()
    const { controller } = createController()
    controller.messages.value = [message('copied twice')]

    await controller.copyAll()
    await vi.advanceTimersByTimeAsync(1_000)
    await controller.copyAll()
    await vi.advanceTimersByTimeAsync(600)

    expect(controller.copied.value).toBe('all')
    await vi.advanceTimersByTimeAsync(900)
    expect(controller.copied.value).toBeNull()
    controller.dispose()
  })

  it('does not restore copied feedback after the console context resets during clipboard write', async () => {
    const copying = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.messages.value = [message('stale copy')]
    copyText.mockImplementationOnce(() => copying.promise)

    const operation = controller.copyAll()
    controller.reset()
    copying.resolve(true)
    await operation

    expect(controller.copied.value).toBeNull()
    controller.dispose()
  })

  it('keeps the newest console copy scope when clipboard writes finish out of order', async () => {
    const older = deferred<boolean>()
    const newer = deferred<boolean>()
    const { controller, copyText } = createController()
    controller.messages.value = [message('copy order')]
    controller.search.value = 'copy'
    copyText
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise)

    const copyAll = controller.copyAll()
    const copyFiltered = controller.copyFiltered()
    newer.resolve(true)
    await copyFiltered
    older.resolve(true)
    await copyAll

    expect(controller.copied.value).toBe('filtered')
    controller.dispose()
  })

})
