import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises, mount } from '@vue/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HistoryPanel from '../../src/renderer/src/features/history/HistoryPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserBookmark, BrowserHistoryEntry } from '../../src/shared/types.js'
import { getByTooltip } from './helpers/tooltip.js'

function entry(id: string, title = `Page ${id}`, visitCount = 1): BrowserHistoryEntry {
  return {
    id,
    url: `https://example.test/${id}`,
    title,
    visitedAt: '2026-08-22T09:30:00.000Z',
    visitCount
  }
}

function panelProps(overrides: Record<string, unknown> = {}) {
  return {
    open: true,
    bookmarks: [],
    saveHistoryBookmark: vi.fn(async () => undefined),
    entries: [entry('alpha', 'Alpha docs', 2), entry('beta', 'Beta page')],
    formatDateTime: () => 'Aug 22, 2026, 12:30 PM',
    formatNumber: String,
    listHistory: vi.fn(async () => []),
    removeHistoryEntry: vi.fn(async () => []),
    clearHistory: vi.fn(async () => []),
    openHistoryEntry: vi.fn(async () => undefined),
    openHistoryEntryInBackground: vi.fn(async () => undefined),
    copyHistoryAddress: vi.fn(async () => undefined),
    ...overrides
  }
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(HistoryPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: panelProps(overrides)
  })
}

describe('HistoryPanel', () => {
  it('filters exact origins separately from substring search and clears with keyboard focus', async () => {
    const rows = [
      { ...entry('alpha', 'Docs'), url: 'https://docs.example/guide' },
      { ...entry('beta', 'Docs query'), url: 'https://other.example/?next=https://docs.example/' },
      { ...entry('gamma', 'Docs suffix'), url: 'https://docs.example.evil.test/' },
      { ...entry('port', 'Docs port'), url: 'https://docs.example:8443/' },
      { ...entry('scheme', 'Docs HTTP'), url: 'http://docs.example/' }
    ]
    const view = renderPanel({ entries: rows })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'docs.example')
    expect(view.container.querySelectorAll('.history-item')).toHaveLength(5)
    const filter = screen.getByRole('button', { name: 'Filter history by origin of Docs' })
    filter.focus()
    await user.keyboard('{Enter}')
    expect(view.container.querySelectorAll('.history-item')).toHaveLength(1)
    expect(filter).toHaveFocus()
    const clear = screen.getByRole('button', { name: 'Clear origin filter' })
    clear.focus()
    await user.keyboard('{Enter}')
    expect(view.container.querySelectorAll('.history-item')).toHaveLength(5)
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it.each(['external focus', 'close/reopen'])('does not restore stale focus after clearing origin during %s', async mode => {
    const rows = [entry('alpha', 'Alpha docs')]
    const wrapper = mount(HistoryPanel, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: panelProps({ entries: rows, listHistory: vi.fn(async () => rows) })
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Filter history by origin of Alpha docs' }))
    const clear = screen.getByRole('button', { name: 'Clear origin filter' })
    const external = document.createElement('button')
    document.body.append(external)
    const exposed = wrapper.vm as unknown as { toggle(): Promise<void> }
    let observed = false
    const observer = new MutationObserver(() => {
      if (clear.isConnected || observed) return
      observed = true
      if (mode === 'external focus') external.focus()
      else { void exposed.toggle(); void exposed.toggle() }
    })
    observer.observe(screen.getByRole('dialog'), { childList: true, subtree: true })
    try {
      clear.focus()
      await fireEvent.click(clear)
      await flushPromises()
      expect(observed).toBe(true)
      expect(mode === 'external focus' ? external : document.body).toHaveFocus()
      expect(screen.getByRole('dialog')).toBeVisible()
    } finally { observer.disconnect(); external.remove(); wrapper.unmount() }
  })

  it.each(['open', 'bookmark', 'background', 'origin', 'remove'])('recovers focus from the %s control when Today rolls past local midnight', async control => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 23, 59, 59))
    const row = { ...entry('alpha', 'Alpha docs'), visitedAt: new Date(2026, 9, 7, 12).toISOString() }
    const view = renderPanel({ entries: [row] })
    try {
      await fireEvent.update(screen.getByRole('combobox', { name: 'Date range' }), 'today')
      const button = control === 'open' ? getByTooltip(row.url)
        : screen.getByRole('button', { name: control === 'origin' ? 'Filter history by origin of Alpha docs' : control === 'background' ? 'Open Alpha docs in background tab'
          : control === 'bookmark' ? 'Bookmark Alpha docs' : 'Remove Alpha docs from history' })
      button.focus()
      expect(button).toHaveFocus()
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.queryByText('Alpha docs')).not.toBeInTheDocument()
      expect(screen.getByText('No matching visits')).toBeVisible()
      expect(screen.getByRole('searchbox')).toHaveFocus()
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it.each(['open', 'bookmark', 'background', 'origin', 'remove'])('moves a removed row’s %s focus to the corresponding neighboring control', async control => {
    const view = renderPanel()
    const button = (id: 'alpha' | 'beta') => control === 'open'
      ? getByTooltip(entry(id).url)
      : screen.getByRole('button', { name: control === 'origin' ? `Filter history by origin of ${id === 'alpha' ? 'Alpha docs' : 'Beta page'}` : control === 'background'
        ? `Open ${id === 'alpha' ? 'Alpha docs' : 'Beta page'} in background tab` : control === 'bookmark'
        ? `Bookmark ${id === 'alpha' ? 'Alpha docs' : 'Beta page'}`
        : `Remove ${id === 'alpha' ? 'Alpha docs' : 'Beta page'} from history` })
    button('alpha').focus()
    await view.rerender({ entries: [entry('beta', 'Beta page')] })
    await flushPromises()
    expect(button('beta')).toHaveFocus()
  })

  it('uses Close when a live update empties the retained history', async () => {
    const view = renderPanel()
    screen.getByRole('button', { name: 'Bookmark Alpha docs' }).focus()
    await view.rerender({ entries: [] })
    await flushPromises()
    expect(screen.getByRole('button', { name: 'Close browsing history' })).toHaveFocus()
  })

  it.each(['search', 'date'])('keeps the %s control focused when changing a filter hides a row', async filter => {
    const view = renderPanel()
    const target = filter === 'search' ? screen.getByRole('searchbox') : screen.getByRole('combobox', { name: 'Date range' })
    target.focus()
    await fireEvent.update(target, filter === 'search' ? 'no match' : 'today')
    expect(target).toHaveFocus()
    view.unmount()
  })

  it('does not steal focus moved outside History while a live row update is rendering', async () => {
    const view = renderPanel()
    const focused = screen.getByRole('button', { name: 'Bookmark Alpha docs' })
    const external = document.createElement('button')
    external.textContent = 'Other action'
    document.body.append(external)
    const observer = new MutationObserver(() => { if (!focused.isConnected) external.focus() })
    observer.observe(screen.getByRole('dialog'), { childList: true, subtree: true })
    try {
      focused.focus()
      await view.rerender({ entries: [entry('beta', 'Beta page')] })
      await flushPromises()
      expect(external).toHaveFocus()
    } finally { observer.disconnect(); external.remove() }
  })

  it('invalidates a queued live focus recovery when the same panel closes and reopens before rendering', async () => {
    let finishLoad!: (rows: BrowserHistoryEntry[]) => void
    const beta = entry('beta', 'Beta page')
    const wrapper = mount(HistoryPanel, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: panelProps({ listHistory: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finishLoad = resolve })) })
    })
    const panel = screen.getByRole('dialog')
    const exposed = wrapper.vm as unknown as { toggle(): Promise<void> }
    const focused = screen.getByRole('button', { name: 'Bookmark Alpha docs' })
    let reopened = false
    const observer = new MutationObserver(() => {
      if (focused.isConnected || reopened) return
      reopened = true
      // Both changes happen before Vue can replace the panel DOM, so checking
      // only isConnected would incorrectly allow the old focus restoration.
      void exposed.toggle()
      void exposed.toggle()
    })
    observer.observe(panel, { childList: true, subtree: true })
    try {
      focused.focus()
      await wrapper.setProps({ entries: [beta] })
      await flushPromises()
      expect(reopened).toBe(true)
      expect(screen.getByRole('dialog')).toBe(panel)
      expect(document.body).toHaveFocus()
      finishLoad([beta])
      await flushPromises()
      expect(document.body).toHaveFocus()
    } finally { observer.disconnect(); wrapper.unmount() }
  })

  it('keeps newer focus when a live date refresh overlaps an asynchronous removal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 7, 23, 59, 59))
    let finish!: (rows: BrowserHistoryEntry[]) => void
    const row = { ...entry('alpha', 'Alpha docs'), visitedAt: new Date(2026, 9, 7, 12).toISOString() }
    const view = renderPanel({ entries: [row], removeHistoryEntry: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    try {
      await fireEvent.update(screen.getByRole('combobox', { name: 'Date range' }), 'today')
      const remove = screen.getByRole('button', { name: 'Remove Alpha docs from history' })
      remove.focus()
      await fireEvent.click(remove)
      const select = screen.getByRole('combobox', { name: 'Date range' })
      select.focus()
      await vi.advanceTimersByTimeAsync(1000)
      expect(select).toHaveFocus()
      // A completion that retains the entry must not reclaim focus.
      finish([row])
      await flushPromises()
      expect(select).toHaveFocus()
    } finally { view.unmount(); vi.useRealTimers() }
  })

  it('offers an accessible date selector that composes with search and survives reopening', async () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const rows = [
      { ...entry('alpha', 'Alpha docs'), visitedAt: today.toISOString() },
      { ...entry('beta', 'Beta page'), visitedAt: yesterday.toISOString() }
    ]
    const view = renderPanel({ entries: rows })
    const user = userEvent.setup()
    const select = screen.getByRole('combobox', { name: 'Date range' })
    expect(select).toHaveValue('all')
    await user.selectOptions(select, 'today')
    expect(screen.getByText('Alpha docs')).toBeVisible()
    expect(screen.queryByText('Beta page')).not.toBeInTheDocument()
    await user.type(screen.getByRole('searchbox'), 'beta')
    expect(screen.getByText('No matching visits')).toBeVisible()
    await user.selectOptions(select, 'last7Days')
    expect(screen.getByText('Beta page')).toBeVisible()
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    expect(screen.getByRole('combobox', { name: 'Date range' })).toHaveValue('last7Days')
    expect(screen.getByRole('searchbox')).toHaveValue('beta')
    expect(screen.getByText('Beta page')).toBeVisible()
  })

  it('saves a history entry by keyboard without opening it or closing the panel', async () => {
    const saveHistoryBookmark = vi.fn(async () => undefined)
    const openHistoryEntry = vi.fn(async () => undefined)
    renderPanel({ bookmarks: [], saveHistoryBookmark, openHistoryEntry })
    const button = screen.getByRole('button', { name: 'Bookmark Alpha docs' })
    button.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(saveHistoryBookmark).toHaveBeenCalledWith('https://example.test/alpha', 'Alpha docs')
    expect(openHistoryEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Browsing history' })).toBeVisible()
    expect(button).toHaveFocus()
  })

  it.each(['first', 'last', 'filtered', 'only'])('preserves keyboard access after removing the %s entry', async scenario => {
    const alpha = entry('alpha', 'Alpha docs')
    const beta = entry('beta', 'Beta page')
    const removed = scenario === 'last' ? beta : alpha
    const remaining = scenario === 'only' ? [] : [scenario === 'last' ? alpha : beta]
    const removeHistoryEntry = vi.fn(async () => remaining)
    renderPanel({ entries: scenario === 'only' ? [alpha] : [alpha, beta], removeHistoryEntry })
    const user = userEvent.setup()
    if (scenario === 'filtered') await user.type(screen.getByRole('searchbox'), 'Alpha')
    const button = screen.getByRole('button', { name: `Remove ${removed.title} from history` })
    button.focus()
    await user.keyboard('{Enter}')

    expect(removeHistoryEntry).toHaveBeenCalledWith(removed.id)
    expect(screen.queryByRole('button', { name: `Remove ${removed.title} from history` })).not.toBeInTheDocument()
    const destination = scenario === 'only'
      ? screen.getByRole('button', { name: 'Close browsing history' })
      : scenario === 'filtered'
        ? screen.getByRole('searchbox')
        : screen.getByRole('button', { name: `Remove ${remaining[0].title} from history` })
    expect(destination).toHaveFocus()
  })

  it('preserves newer focus while history removal is pending', async () => {
    let finish!: (entries: BrowserHistoryEntry[]) => void
    renderPanel({ removeHistoryEntry: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha docs from history' }))
    const search = screen.getByRole('searchbox')
    await user.click(search)
    finish([entry('beta', 'Beta page')])
    await flushPromises()
    expect(search).toHaveFocus()
  })

  it('gives the focus to the next Remove when the live list drops the row before its removal finishes', async () => {
    let finish!: (entries: BrowserHistoryEntry[]) => void
    const beta = entry('beta', 'Beta page')
    const view = renderPanel({ removeHistoryEntry: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    const remove = screen.getByRole('button', { name: 'Remove Alpha docs from history' })
    remove.focus()
    await fireEvent.click(remove)

    // Main publishes the new list before it answers the removal, while the other rows' controls are still disabled.
    await view.rerender({ entries: [beta] })
    await flushPromises()
    finish([beta])
    await flushPromises()

    // The live list used to give the focus to Search, passing over the next row's Remove while it was disabled.
    expect(screen.getByRole('button', { name: 'Remove Beta page from history' })).toHaveFocus()
  })

  it('does not restore removal focus into a reopened panel', async () => {
    let finish!: (entries: BrowserHistoryEntry[]) => void
    const view = renderPanel({ removeHistoryEntry: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove Alpha docs from history' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true, entries: [entry('beta', 'Beta page')] })
    finish([entry('beta', 'Beta page')])
    await flushPromises()
    expect(document.body).toHaveFocus()
  })

  it('keeps the removal control reachable after a failed removal', async () => {
    renderPanel({ removeHistoryEntry: vi.fn(async () => { throw new Error('Removal failed') }) })
    const user = userEvent.setup()
    const remove = screen.getByRole('button', { name: 'Remove Alpha docs from history' })
    await user.click(remove)
    expect(await screen.findByRole('alert')).toHaveTextContent('Removal failed')
    expect(remove).toHaveFocus()
  })

  it('renders visit metadata and filters by URL without losing the retained entries', async () => {
    renderPanel()

    expect(screen.getByRole('dialog', { name: 'Browsing history' })).toBeVisible()
    expect(screen.getByText('Aug 22, 2026, 12:30 PM · 2 visits')).toBeVisible()

    await fireEvent.update(screen.getByRole('searchbox', { name: 'Search browsing history' }), 'example.test/beta')
    expect(screen.getByText('Beta page')).toBeVisible()
    expect(screen.queryByText('Alpha docs')).not.toBeInTheDocument()
  })

  it('keeps failed navigation visible and allows the user to retry', async () => {
    const openHistoryEntry = vi.fn()
      .mockRejectedValueOnce(new Error('Could not open the page'))
      .mockResolvedValueOnce(undefined)
    renderPanel({ entries: [entry('alpha', 'Alpha docs')], openHistoryEntry })
    const user = userEvent.setup()
    const open = getByTooltip('https://example.test/alpha')

    await user.click(open)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the page')
    expect(screen.getByRole('dialog', { name: 'Browsing history' })).toBeVisible()

    await user.click(open)
    expect(openHistoryEntry).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog', { name: 'Browsing history' })).not.toBeInTheDocument()
  })

  it('does not clear history when confirmation is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const clearHistory = vi.fn(async () => [])
    renderPanel({ clearHistory })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Clear all' }))

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(clearHistory).not.toHaveBeenCalled()
    expect(screen.getByText('Alpha docs')).toBeVisible()
    confirmSpy.mockRestore()
  })
})

describe('History background opening', () => {
  it('retains the panel, filters and keyboard focus while opening a background result', async () => {
    const openHistoryEntryInBackground = vi.fn(async () => undefined)
    const openHistoryEntry = vi.fn(async () => undefined)
    const row = { ...entry('alpha', 'Alpha docs'), visitedAt: new Date().toISOString() }
    renderPanel({ entries: [row], openHistoryEntryInBackground, openHistoryEntry })
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox')
    const date = screen.getByRole('combobox', { name: 'Date range' })
    await user.type(search, 'Alpha')
    await user.selectOptions(date, 'last7Days')
    const button = screen.getByRole('button', { name: 'Open Alpha docs in background tab' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(openHistoryEntryInBackground).toHaveBeenCalledExactlyOnceWith(row)
    expect(openHistoryEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(search).toHaveValue('Alpha')
    expect(date).toHaveValue('last7Days')
    expect(button).toHaveFocus()
  })

  it('blocks pending duplicates and keeps failure visible for keyboard retry', async () => {
    let reject!: (error: Error) => void
    const openHistoryEntryInBackground = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    const openHistoryEntry = vi.fn(async () => undefined)
    renderPanel({ openHistoryEntryInBackground, openHistoryEntry })
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Open Alpha docs in background tab' })
    await user.click(button)
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await user.keyboard('{Enter} ')
    await fireEvent.click(screen.getByRole('button', { name: 'Open Beta page in background tab' }))
    expect(openHistoryEntryInBackground).toHaveBeenCalledOnce()
    reject(new Error('Tab limit reached'))
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('Tab limit reached')
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('aria-disabled', 'false')
    openHistoryEntryInBackground.mockResolvedValueOnce(undefined)
    await user.keyboard('{Enter}')
    expect(openHistoryEntryInBackground).toHaveBeenCalledTimes(2)
    expect(openHistoryEntry).not.toHaveBeenCalled()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(button).toHaveFocus()
  })

  it.each(['search', 'date'])('preserves newer %s focus while a background action completes', async control => {
    let finish!: () => void
    renderPanel({ openHistoryEntryInBackground: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    const target = control === 'search' ? screen.getByRole('searchbox') : screen.getByRole('combobox', { name: 'Date range' })
    if (control === 'search') await user.type(target, 'Beta')
    else await user.selectOptions(target, 'last7Days')
    finish()
    await flushPromises()
    expect(target).toHaveFocus()
    expect(target).toHaveValue(control === 'search' ? 'Beta' : 'last7Days')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it.each(['resolve', 'reject'])('ignores late %s after close and reopen while a newer action is pending', async outcome => {
    let finishOld!: () => void
    let rejectOld!: (error: Error) => void
    let finishNew!: () => void
    const openHistoryEntryInBackground = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve, fail) => { finishOld = resolve; rejectOld = fail }))
      .mockImplementationOnce(() => new Promise<void>(resolve => { finishNew = resolve }))
    const view = renderPanel({ openHistoryEntryInBackground })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    const button = screen.getByRole('button', { name: 'Open Beta page in background tab' })
    await user.click(button)
    if (outcome === 'resolve') finishOld()
    else rejectOld(new Error('Old failure'))
    await flushPromises()
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    expect(search).toHaveValue('Beta')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('dialog')).toBeVisible()
    finishNew()
    await flushPromises()
    expect(button).toHaveAttribute('aria-disabled', 'false')
  })

  it.each(['resolve', 'reject'])('does not reopen History after a late %s while closed', async outcome => {
    let finish!: () => void
    let reject!: (error: Error) => void
    const view = renderPanel({ openHistoryEntryInBackground: vi.fn(() => new Promise<void>((resolve, fail) => { finish = resolve; reject = fail })) })
    await userEvent.setup().click(screen.getByRole('button', { name: 'Open Alpha docs in background tab' }))
    await view.rerender({ open: false })
    if (outcome === 'resolve') finish()
    else reject(new Error('Closed operation failed'))
    await flushPromises()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('History bookmark races', () => {
  it('keeps an already saved control focused and prevents repeat clicks', async () => {
    const saveHistoryBookmark = vi.fn(async () => undefined)
    const view = renderPanel({ saveHistoryBookmark })
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Bookmark Alpha docs' })
    await user.click(button)
    const saved: BrowserBookmark = { id: 'saved', url: entry('alpha').url, title: 'Custom title', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    await view.rerender({ bookmarks: [saved] })
    expect(button).toHaveAccessibleName('Already bookmarked: Alpha docs')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveFocus()
    await user.keyboard('{Enter} ')
    await fireEvent.click(button)
    expect(saveHistoryBookmark).toHaveBeenCalledOnce()
  })

  it('blocks duplicate pending saves, preserves search focus and keeps errors retryable', async () => {
    let reject!: (error: Error) => void
    const saveHistoryBookmark = vi.fn(() => new Promise<void>((_, fail) => { reject = fail }))
    renderPanel({ saveHistoryBookmark })
    const user = userEvent.setup()
    const button = screen.getByRole('button', { name: 'Bookmark Alpha docs' })
    await user.click(button)
    await fireEvent.click(button)
    expect(saveHistoryBookmark).toHaveBeenCalledOnce()
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    reject(new Error('Disk unavailable'))
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('Beta')
    expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable')
    await user.clear(search)
    expect(screen.getByRole('button', { name: 'Bookmark Alpha docs' })).toHaveAttribute('aria-disabled', 'false')
  })

  it.each(['resolve', 'reject'])('ignores late %s after close and reopen', async outcome => {
    let finish!: () => void
    let reject!: (error: Error) => void
    const saveHistoryBookmark = vi.fn(() => new Promise<void>((resolve, fail) => { finish = resolve; reject = fail }))
    const view = renderPanel({ saveHistoryBookmark })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Bookmark Alpha docs' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    const search = screen.getByRole('searchbox')
    await user.type(search, 'Beta')
    if (outcome === 'resolve') finish()
    else reject(new Error('Old failure'))
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('Beta')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeVisible()
  })
})

describe('History copy address', () => {
  it('copies only the stored URL and retains filters, panel and keyboard focus', async () => {
    const row = { ...entry('alpha', 'Alpha docs'), url: 'https://example.test/path?q=a%20b#part', visitedAt: new Date().toISOString() }
    const copyHistoryAddress = vi.fn(async () => undefined)
    const openHistoryEntry = vi.fn(async () => undefined)
    renderPanel({ entries: [row], copyHistoryAddress, openHistoryEntry })
    const search = screen.getByRole('searchbox')
    const date = screen.getByRole('combobox', { name: 'Date range' })
    await fireEvent.update(search, 'Alpha docs')
    await fireEvent.update(date, 'today')
    const copy = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
    copy.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(copyHistoryAddress).toHaveBeenCalledExactlyOnceWith(row)
    expect(openHistoryEntry).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Address copied')
    expect(copy).toHaveFocus()
    expect(search).toHaveValue('Alpha docs')
    expect(date).toHaveValue('today')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('blocks duplicate pending copies and shows a generic retryable error', async () => {
    let reject!: (cause: Error) => void
    const copyHistoryAddress = vi.fn().mockImplementationOnce(() => new Promise<void>((_resolve, rejectCopy) => { reject = rejectCopy })).mockResolvedValue(undefined)
    renderPanel({ copyHistoryAddress })
    const copy = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
    copy.focus()
    await fireEvent.click(copy)
    await fireEvent.click(copy)
    expect(copyHistoryAddress).toHaveBeenCalledTimes(1)
    expect(copy).toHaveAttribute('aria-disabled', 'true')
    reject(new Error('sensitive backend detail'))
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('Could not copy address. Try again.')
    expect(screen.queryByText('sensitive backend detail')).not.toBeInTheDocument()
    expect(copy).toHaveFocus()
    await fireEvent.click(copy)
    await flushPromises()
    expect(copyHistoryAddress).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Address copied')
  })

  it.each(['query', 'date', 'remove', 'url', 'reopen', 'unmount'].flatMap(change => ['success', 'error'].map(result => ({ change, result }))))('ignores stale $result after $change while copying', async ({ change, result }) => {
    let resolve!: () => void
    let reject!: (cause: Error) => void
    const row = { ...entry('alpha', 'Alpha docs'), visitedAt: new Date().toISOString() }
    const copyHistoryAddress = vi.fn(() => new Promise<void>((yes, no) => { resolve = yes; reject = no }))
    const view = renderPanel({ entries: [row, entry('beta', 'Beta page')], copyHistoryAddress })
    const copy = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
    copy.focus()
    await fireEvent.click(copy)
    if (change === 'query') await fireEvent.update(screen.getByRole('searchbox'), 'Alpha')
    if (change === 'date') await fireEvent.update(screen.getByRole('combobox', { name: 'Date range' }), 'today')
    if (change === 'remove') await view.rerender({ entries: [entry('beta', 'Beta page')] })
    if (change === 'url') await view.rerender({ entries: [{ ...row, url: 'https://example.test/new' }] })
    if (change === 'reopen') { await view.rerender({ open: false }); await view.rerender({ open: true }) }
    if (change === 'unmount') view.unmount()
    const search = screen.queryByRole('searchbox')
    search?.focus()
    if (result === 'success') resolve(); else reject(new Error('late failure'))
    await flushPromises()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    if (search) expect(search).toHaveFocus()
  })

  it('recovers to the next Copy control when the copied row disappears without stealing newer focus', async () => {
    let finish!: () => void
    const view = renderPanel({ copyHistoryAddress: vi.fn(() => new Promise<void>(resolve => { finish = resolve })) })
    const copy = screen.getByRole('button', { name: 'Copy address for Alpha docs' })
    copy.focus()
    await fireEvent.click(copy)
    await view.rerender({ entries: [entry('beta', 'Beta page')] })
    await flushPromises()
    const next = screen.getByRole('button', { name: 'Copy address for Beta page' })
    expect(next).toHaveFocus()
    expect(next).toHaveAttribute('aria-disabled', 'true')
    finish()
    await flushPromises()
    expect(next).toHaveFocus()
    expect(next).toHaveAttribute('aria-disabled', 'false')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})

it.each(['success', 'error'])('keeps a newer copy pending when an old session finishes with %s', async result => {
  let resolveOld!: () => void
  let rejectOld!: (cause: Error) => void
  let resolveNew!: () => void
  const copyHistoryAddress = vi.fn()
    .mockImplementationOnce(() => new Promise<void>((resolve, reject) => { resolveOld = resolve; rejectOld = reject }))
    .mockImplementationOnce(() => new Promise<void>(resolve => { resolveNew = resolve }))
  const view = renderPanel({ copyHistoryAddress })
  await fireEvent.click(screen.getByRole('button', { name: 'Copy address for Alpha docs' }))
  await view.rerender({ open: false })
  await view.rerender({ open: true })
  const copy = screen.getByRole('button', { name: 'Copy address for Beta page' })
  copy.focus()
  await fireEvent.click(copy)
  if (result === 'success') resolveOld(); else rejectOld(new Error('old failure'))
  await flushPromises()
  expect(copy).toHaveAttribute('aria-disabled', 'true')
  expect(copy).toHaveFocus()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  await fireEvent.click(copy)
  expect(copyHistoryAddress).toHaveBeenCalledTimes(2)
  resolveNew()
  await flushPromises()
  expect(copy).toHaveAttribute('aria-disabled', 'false')
  expect(screen.getByRole('status')).toHaveTextContent('Address copied')
})

it('orders History by most visits without changing the authoritative list and retains the choice on reopen', async () => {
  const rows = [entry('recent', 'Recent page', 1), entry('frequent', 'Frequent page', 8)]
  const view = renderPanel({ entries: rows })
  const titles = () => [...view.container.querySelectorAll('.history-copy strong')].map(node => node.textContent)
  expect(titles()).toEqual(['Recent page', 'Frequent page'])
  const sort = screen.getByRole('combobox', { name: 'Sort history' })
  expect(sort).toHaveValue('recent')
  await fireEvent.update(sort, 'visits')
  expect(titles()).toEqual(['Frequent page', 'Recent page'])
  expect(rows.map(row => row.id)).toEqual(['recent', 'frequent'])
  await view.rerender({ open: false })
  await view.rerender({ open: true })
  expect(screen.getByRole('combobox', { name: 'Sort history' })).toHaveValue('visits')
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort history' }), 'recent')
  expect(titles()).toEqual(['Recent page', 'Frequent page'])
})

it.each(['copy', 'background', 'bookmark'])('retains pending %s focus when a visit count update moves its row', async action => {
  let finish!: () => void
  const operation = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderPanel({
    entries: [entry('high', 'Higher', 3), entry('low', 'Lower', 1)],
    [action === 'copy' ? 'copyHistoryAddress' : action === 'background' ? 'openHistoryEntryInBackground' : 'saveHistoryBookmark']: operation
  })
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort history' }), 'visits')
  const button = screen.getByRole('button', { name: action === 'copy' ? 'Copy address for Lower' : action === 'background' ? 'Open Lower in background tab' : 'Bookmark Lower' })
  await userEvent.setup().click(button)
  expect(button).toHaveAttribute('aria-disabled', 'true')
  await view.rerender({ entries: [entry('high', 'Higher', 3), entry('low', 'Lower', 5)] })
  await flushPromises()
  expect([...view.container.querySelectorAll('.history-copy strong')].map(node => node.textContent)).toEqual(['Lower', 'Higher'])
  expect(button).toHaveFocus()
  await fireEvent.click(button)
  expect(operation).toHaveBeenCalledTimes(1)
  finish()
  await flushPromises()
  expect(button).toHaveFocus()
})

it.each(['copy', 'background', 'bookmark'])('preserves newer search focus through a pending %s visit reorder', async action => {
  let finish!: () => void
  const operation = vi.fn(() => new Promise<void>(resolve => { finish = resolve }))
  const view = renderPanel({
    entries: [entry('high', 'Higher', 3), entry('low', 'Lower', 1)],
    [action === 'copy' ? 'copyHistoryAddress' : action === 'background' ? 'openHistoryEntryInBackground' : 'saveHistoryBookmark']: operation
  })
  await fireEvent.update(screen.getByRole('combobox', { name: 'Sort history' }), 'visits')
  await userEvent.setup().click(screen.getByRole('button', { name: action === 'copy' ? 'Copy address for Lower' : action === 'background' ? 'Open Lower in background tab' : 'Bookmark Lower' }))
  const update = view.rerender({ entries: [entry('high', 'Higher', 3), entry('low', 'Lower', 5)] })
  const search = screen.getByRole('searchbox')
  search.focus()
  await update
  await flushPromises()
  expect(search).toHaveFocus()
  finish()
  await flushPromises()
  expect(search).toHaveFocus()
})

describe('History keyboard focus while an action disables its control', () => {
  // Chromium moves the focus of a control to the page body while the control is disabled. JSDOM cannot blur a
  // disabled control, so it is enabled for the blur itself.
  function dropFocusLikeChromium(control: HTMLElement): void {
    control.removeAttribute('disabled')
    control.blur()
    control.setAttribute('disabled', '')
    expect(document.body).toHaveFocus()
  }

  // Opening an entry disables every Open control until it settles. When opening failed, the panel stayed open with
  // the error, but nothing gave the focus back: Enter could not retry and the next Tab started at the top of the window.
  it('gives the focus back to the entry once opening it fails', async () => {
    let reject!: (cause: Error) => void
    const openHistoryEntry = vi.fn(() => new Promise<void>((_resolve, fail) => { reject = fail }))
    renderPanel({ openHistoryEntry })
    const open = getByTooltip('https://example.test/alpha')
    open.focus()
    await userEvent.setup().keyboard('{Enter}')
    expect(open).toBeDisabled()
    dropFocusLikeChromium(open)

    reject(new Error('Could not open the page'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open the page')
    await flushPromises()

    expect(open).toBeEnabled()
    expect(open).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Browsing history' })).toBeVisible()
  })

  // Clear all stays disabled once History is empty, so Chromium's blur left the focus on the page body for good.
  it('moves the focus to Close once Clear all empties History', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish!: (rows: BrowserHistoryEntry[]) => void
    renderPanel({ clearHistory: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    try {
      const clear = screen.getByRole('button', { name: 'Clear all' })
      clear.focus()
      await userEvent.setup().keyboard('{Enter}')
      expect(clear).toBeDisabled()
      dropFocusLikeChromium(clear)

      finish([])
      await flushPromises()

      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
      expect(clear).toBeDisabled()
      expect(screen.getByRole('button', { name: 'Close browsing history' })).toHaveFocus()
    } finally { confirmSpy.mockRestore() }
  })

  it('gives the focus back to Clear all when clearing fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let reject!: (cause: Error) => void
    renderPanel({ clearHistory: vi.fn(() => new Promise<BrowserHistoryEntry[]>((_resolve, fail) => { reject = fail })) })
    try {
      const clear = screen.getByRole('button', { name: 'Clear all' })
      clear.focus()
      await userEvent.setup().keyboard('{Enter}')
      dropFocusLikeChromium(clear)

      reject(new Error('History could not be cleared'))
      expect(await screen.findByRole('alert')).toHaveTextContent('History could not be cleared')
      await flushPromises()

      expect(clear).toBeEnabled()
      expect(clear).toHaveFocus()
    } finally { confirmSpy.mockRestore() }
  })

  it.each(['moved', 'closed'])('leaves the focus alone when you %s it while Clear all was pending', async change => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    let finish!: (rows: BrowserHistoryEntry[]) => void
    const external = document.createElement('button')
    document.body.append(external)
    const view = renderPanel({ clearHistory: vi.fn(() => new Promise<BrowserHistoryEntry[]>(resolve => { finish = resolve })) })
    try {
      const clear = screen.getByRole('button', { name: 'Clear all' })
      clear.focus()
      await userEvent.setup().keyboard('{Enter}')
      dropFocusLikeChromium(clear)
      if (change === 'moved') external.focus()
      else { await view.rerender({ open: false }); await view.rerender({ open: true }) }

      finish([])
      await flushPromises()

      expect(change === 'moved' ? external : document.body).toHaveFocus()
    } finally { confirmSpy.mockRestore(); external.remove() }
  })
})

describe('held Enter', () => {
  it('keeps a held Enter from pressing Remove or Close again', () => {
    renderPanel()
    for (const name of ['Remove Alpha docs from history', 'Close browsing history']) {
      const button = screen.getByRole('button', { name })
      const press = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      const repeat = new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true })
      button.dispatchEvent(press)
      button.dispatchEvent(repeat)

      // Remove hands its focus to the next row's Remove, and the last row's to Close, so each repeat of a held Enter
      // pressed one more of them.
      expect(press.defaultPrevented).toBe(false)
      expect(repeat.defaultPrevented).toBe(true)
    }
  })
})

// A middle-click or Ctrl+click on a visit opened it in front and closed History, where Chrome opens it in a new tab
// behind.
describe('opening a visit behind with a middle-click or Ctrl+click, as in Chrome', () => {
  it('opens it in a new tab behind and keeps History open, and in front with Shift as a click does', async () => {
    const openHistoryEntryInBackground = vi.fn(async () => undefined)
    const openHistoryEntry = vi.fn(async () => undefined)
    const alpha = { ...entry('alpha', 'Alpha docs'), visitedAt: new Date().toISOString() }
    const beta = { ...entry('beta', 'Beta page'), visitedAt: new Date().toISOString() }
    const view = renderPanel({ entries: [alpha, beta], openHistoryEntryInBackground, openHistoryEntry })
    const alphaRow = screen.getByRole('button', { name: /^Alpha docs/ })

    const event = new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1, detail: 1 })
    alphaRow.dispatchEvent(event)
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: /^Beta page/ }), { ctrlKey: true, detail: 1 })
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(openHistoryEntryInBackground.mock.calls).toEqual([[alpha], [beta]])
    expect(openHistoryEntry).not.toHaveBeenCalled()
    expect(view.emitted()['update:open']).toBeUndefined()

    await fireEvent.click(alphaRow, { ctrlKey: true, shiftKey: true, detail: 1 })
    await flushPromises()
    expect(openHistoryEntry).toHaveBeenCalledExactlyOnceWith(alpha)
    expect(openHistoryEntryInBackground).toHaveBeenCalledTimes(2)
  })
})
