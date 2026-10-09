import { ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useHistoryPanelController } from '../../src/renderer/src/composables/useHistoryPanelController.js'
import type { BrowserHistoryEntry } from '../../src/shared/types.js'

function entry(id: string, title = `Page ${id}`, visitCount = 1): BrowserHistoryEntry {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    visitedAt: '2026-08-22T09:30:00.000Z',
    visitCount
  }
}

function createController(initialEntries = [entry('alpha')]) {
  const open = ref(false)
  const entries = ref(initialEntries)
  const listHistory = vi.fn(async () => entries.value)
  const removeHistoryEntry = vi.fn(async (id: string) => entries.value.filter((item) => item.id !== id))
  const clearHistory = vi.fn(async () => [])
  const openHistoryEntry = vi.fn(async () => undefined)
  const confirmClear = vi.fn(() => true)
  const controller = useHistoryPanelController({
    open,
    entries,
    translate: (key, parameters) => key === 'history.visits' ? `${parameters?.count} visits` : key,
    formatDateTime: () => 'Aug 22, 2026, 12:30 PM',
    formatNumber: String,
    listHistory,
    removeHistoryEntry,
    clearHistory,
    openHistoryEntry,
    openHistoryEntryInBackground: vi.fn(async () => undefined),
    copyHistoryAddress: vi.fn(async () => undefined),
    saveHistoryBookmark: vi.fn(async () => undefined),
    confirmClear
  })
  return {
    open,
    entries,
    listHistory,
    removeHistoryEntry,
    clearHistory,
    openHistoryEntry,
    confirmClear,
    controller
  }
}

describe('history panel controller', () => {
  it.each([
    ['build alpha.example', ['alpha']],
    [' ALPHA.EXAMPLE\tBUILD ', ['alpha']],
    ['guide archive', ['beta']],
    ['[v2] alpha.example', ['alpha']],
    ['build beta.example', []],
    ['build missing', []],
    ['build', ['alpha']],
    ['   \t ', ['alpha', 'beta']],
    ['alpha.example', ['alpha']]
  ])('matches literal history terms across one title and address: %s', (query, expected) => {
    const rows = [
      { ...entry('alpha', 'Build report [v2]'), url: 'https://alpha.example/reports' },
      { ...entry('beta', 'Archive guide'), url: 'https://beta.example/docs' }
    ]
    const h = createController(rows)
    h.controller.query.value = query
    expect(h.controller.filteredEntries.value.map(row => row.id)).toEqual(expected)
    expect(h.entries.value).toEqual(rows)
    h.controller.dispose()
  })

  it('composes canonical HTTP origins with date/text and preserves filters across reopen and live updates', () => {
    const now = new Date().toISOString()
    const rows = [
      { ...entry('one', 'Guide'), url: 'https://DOCS.example:443/a', visitedAt: now },
      { ...entry('two', 'Guide old'), url: 'https://docs.example/b', visitedAt: '2000-01-01T00:00:00Z' },
      { ...entry('title', 'docs.example'), url: 'https://other.example/', visitedAt: now },
      { ...entry('invalid'), url: 'not a URL', visitedAt: now },
      { ...entry('opaque'), url: 'data:text/plain,docs.example', visitedAt: now }
    ]
    const { controller, open, entries } = createController(rows)
    try {
      controller.filterOrigin(rows[0])
      expect(controller.origin.value).toBe('')
      open.value = true
      controller.filterOrigin(rows[3])
      controller.filterOrigin(rows[4])
      expect(controller.origin.value).toBe('')
      controller.filterOrigin(rows[0])
      expect(controller.origin.value).toBe('https://docs.example')
      expect(controller.filteredEntries.value.map(row => row.id)).toEqual(['one', 'two'])
      controller.dateRange.value = 'today'
      controller.query.value = 'guide'
      expect(controller.filteredEntries.value.map(row => row.id)).toEqual(['one'])
      open.value = false
      open.value = true
      expect(controller.origin.value).toBe('https://docs.example')
      expect(controller.query.value).toBe('guide')
      entries.value = rows.filter(row => row.id !== 'one')
      expect(controller.filteredEntries.value).toEqual([])
      controller.filterOrigin(rows[0])
      expect(controller.origin.value).toBe('https://docs.example')
      controller.dateRange.value = 'all'
      expect(controller.filteredEntries.value.map(row => row.id)).toEqual(['two'])
      controller.origin.value = ''
      controller.query.value = ''
      expect(controller.filteredEntries.value).toBe(entries.value)
    } finally { controller.dispose() }
  })

  afterEach(() => { vi.useRealTimers() })

  it('composes date and text filters over latest visits without changing the retained list', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 12))
    const at = (id: string, day: number, hour = 0, milliseconds = 0) => ({
      ...entry(id, `Docs ${id}`, 50),
      visitedAt: new Date(2026, 9, day, hour, 0, 0, milliseconds).toISOString()
    })
    const rows = [at('today', 7), at('yesterday', 6, 23), at('six-days', 1),
      at('too-old', 1, 0, -1), at('tomorrow', 8)]
    const { open, entries, clearHistory, controller } = createController(rows)
    try {
      open.value = true
      controller.dateRange.value = 'today'
      expect(controller.filteredEntries.value.map(item => item.id)).toEqual(['today'])
      controller.dateRange.value = 'last7Days'
      expect(controller.filteredEntries.value.map(item => item.id)).toEqual(['today', 'yesterday', 'six-days'])
      controller.query.value = 'EXAMPLE.TEST/SIX-DAYS'
      expect(controller.filteredEntries.value.map(item => item.id)).toEqual(['six-days'])
      expect(entries.value).toEqual(rows)
      // A new authoritative visit moves an existing URL into Today.
      entries.value = rows.map(item => item.id === 'six-days' ? at('six-days', 7, 11) : item)
      controller.dateRange.value = 'today'
      expect(controller.filteredEntries.value.map(item => item.id)).toEqual(['six-days'])
      controller.dateRange.value = 'all'
      controller.query.value = ''
      expect(controller.filteredEntries.value).toBe(entries.value)
      controller.dateRange.value = 'today'
      controller.query.value = 'no match'
      await controller.clear()
      expect(clearHistory).toHaveBeenCalledOnce()
      expect(entries.value).toEqual([])
    } finally { controller.dispose() }
  })

  it('refreshes across midnight, sleep and reopen, and releases clock resources', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 23, 59, 59))
    const row = { ...entry('today'), visitedAt: new Date(2026, 9, 7, 12).toISOString() }
    const { open, controller } = createController([row])
    const removeWindowListener = vi.spyOn(window, 'removeEventListener')
    const removeDocumentListener = vi.spyOn(document, 'removeEventListener')
    try {
      controller.dateRange.value = 'today'
      open.value = true
      expect(controller.filteredEntries.value).toHaveLength(1)
      expect(vi.getTimerCount()).toBe(1)
      await vi.advanceTimersByTimeAsync(1000)
      expect(controller.filteredEntries.value).toHaveLength(0)
      vi.setSystemTime(new Date(2026, 9, 7, 12))
      window.dispatchEvent(new Event('focus'))
      expect(controller.filteredEntries.value).toHaveLength(1)
      vi.setSystemTime(new Date(2026, 9, 8, 12))
      document.dispatchEvent(new Event('visibilitychange'))
      expect(controller.filteredEntries.value).toHaveLength(0)
      open.value = false
      expect(vi.getTimerCount()).toBe(0)
      vi.setSystemTime(new Date(2026, 9, 7, 12))
      open.value = true
      expect(controller.dateRange.value).toBe('today')
      expect(controller.filteredEntries.value).toHaveLength(1)
      vi.setSystemTime(new Date(2026, 9, 8, 12))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(controller.filteredEntries.value).toHaveLength(0)
      controller.dateRange.value = 'all'
      expect(vi.getTimerCount()).toBe(0)
      controller.dateRange.value = 'today'
    } finally {
      controller.dispose()
      expect(vi.getTimerCount()).toBe(0)
      expect(removeWindowListener).toHaveBeenCalledWith('focus', expect.any(Function))
      expect(removeDocumentListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
      removeWindowListener.mockRestore()
      removeDocumentListener.mockRestore()
    }
  })

  it('opens the panel and reports a load failure instead of rejecting outside the UI', async () => {
    const { open, entries, listHistory, controller } = createController()
    listHistory.mockRejectedValueOnce(new Error('History storage is unavailable'))

    await controller.toggle()

    expect(open.value).toBe(true)
    expect(entries.value).toHaveLength(1)
    expect(controller.error.value).toBe('History storage is unavailable')
    expect(controller.pendingAction.value).toBeNull()

    await controller.toggle()
    await controller.toggle()
    expect(listHistory).toHaveBeenCalledTimes(2)
    expect(controller.error.value).toBe('')
  })

  it('keeps the panel open when opening an entry fails and closes only after success', async () => {
    const { open, openHistoryEntry, controller } = createController()
    open.value = true
    openHistoryEntry.mockRejectedValueOnce(new Error('Could not open the page'))

    await controller.openEntry(entry('alpha'))
    expect(open.value).toBe(true)
    expect(controller.error.value).toBe('Could not open the page')

    await controller.openEntry(entry('alpha'))
    expect(open.value).toBe(false)
  })

  it('does not let an older entry navigation close a newly reopened panel', async () => {
    let finishNavigation!: () => void
    const navigation = new Promise<undefined>((resolve) => {
      finishNavigation = () => resolve(undefined)
    })
    const { open, openHistoryEntry, controller } = createController()
    open.value = true
    openHistoryEntry.mockReturnValueOnce(navigation)

    const openingEntry = controller.openEntry(entry('alpha'))
    await controller.toggle()
    await controller.toggle()
    expect(open.value).toBe(true)

    finishNavigation()
    await openingEntry

    expect(open.value).toBe(true)
    controller.dispose()
  })

  it('deduplicates overlapping mutations and accepts the authoritative result', async () => {
    let resolveRemove: ((entries: BrowserHistoryEntry[]) => void) | undefined
    const pendingRemove = new Promise<BrowserHistoryEntry[]>((resolve) => {
      resolveRemove = resolve
    })
    const { entries, removeHistoryEntry, controller } = createController([entry('alpha'), entry('beta')])
    removeHistoryEntry.mockReturnValue(pendingRemove)

    const first = controller.remove('alpha')
    const duplicate = controller.remove('alpha')
    expect(removeHistoryEntry).toHaveBeenCalledTimes(1)
    expect(controller.pendingAction.value).toBe('remove:alpha')

    resolveRemove?.([entry('beta')])
    await Promise.all([first, duplicate])

    expect(entries.value.map((item) => item.id)).toEqual(['beta'])
    expect(controller.pendingAction.value).toBeNull()
  })

  it('requires confirmation before clearing and filters titles and addresses', async () => {
    const { entries, clearHistory, confirmClear, controller } = createController([
      entry('alpha', 'Alpha docs', 3),
      entry('beta', 'Beta page')
    ])
    confirmClear.mockReturnValueOnce(false)

    await controller.clear()
    expect(clearHistory).not.toHaveBeenCalled()
    expect(entries.value).toHaveLength(2)

    controller.query.value = 'EXAMPLE.TEST/BETA'
    expect(controller.filteredEntries.value.map((item) => item.id)).toEqual(['beta'])
    expect(controller.entryMeta(entries.value[0])).toBe('Aug 22, 2026, 12:30 PM · 3 visits')
  })
})

it('composes visit order with exact origin, last-visit dates and search without changing stored counts', () => {
  const now = new Date().toISOString()
  const rows = [
    { ...entry('recent', 'Reference recent', 2), visitedAt: now },
    { ...entry('frequent', 'Reference frequent', 9), visitedAt: now },
    { ...entry('tie', 'Reference tie', 9), visitedAt: now },
    { ...entry('old', 'Reference old', 20), visitedAt: '2000-01-01T00:00:00Z' },
    { ...entry('other', 'Reference other', 30), url: 'https://other.test/', visitedAt: now }
  ]
  const h = createController(rows)
  try {
    h.open.value = true
    h.controller.sortOrder.value = 'visits'
    expect(h.controller.filteredEntries.value.map(row => row.id)).toEqual(['other', 'old', 'frequent', 'tie', 'recent'])
    expect(h.entries.value.map(row => row.id)).toEqual(rows.map(row => row.id))
    h.controller.filterOrigin(rows[0])
    h.controller.dateRange.value = 'today'
    h.controller.query.value = 'reference'
    expect(h.controller.filteredEntries.value.map(row => row.id)).toEqual(['frequent', 'tie', 'recent'])
    expect(h.controller.filteredEntries.value.map(row => row.visitCount)).toEqual([9, 9, 2])
    h.entries.value = rows.map(row => row.id === 'recent' ? { ...row, visitCount: 10 } : row)
    expect(h.controller.filteredEntries.value.map(row => row.id)).toEqual(['recent', 'frequent', 'tie'])
    h.controller.query.value = 'missing'
    expect(h.controller.filteredEntries.value).toEqual([])
    h.controller.query.value = ''
    h.controller.sortOrder.value = 'recent'
    expect(h.controller.filteredEntries.value.map(row => row.id)).toEqual(['recent', 'frequent', 'tie'])
  } finally { h.controller.dispose() }
})
