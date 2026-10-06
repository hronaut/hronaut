import { fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import HistoryPanel from '../../src/renderer/src/components/HistoryPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
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

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(HistoryPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      entries: [entry('alpha', 'Alpha docs', 2), entry('beta', 'Beta page')],
      formatDateTime: () => 'Aug 22, 2026, 12:30 PM',
      formatNumber: String,
      listHistory: vi.fn(async () => []),
      removeHistoryEntry: vi.fn(async () => []),
      clearHistory: vi.fn(async () => []),
      openHistoryEntry: vi.fn(async () => undefined),
      ...overrides
    }
  })
}

describe('HistoryPanel', () => {
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
    const open = screen.getByTitle('https://example.test/alpha')

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
