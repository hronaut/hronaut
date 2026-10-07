import { render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import DownloadsPanel from '../../src/renderer/src/components/DownloadsPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserDownloadState } from '../../src/shared/types.js'

function download(
  id: string,
  state: BrowserDownloadState['state'],
  receivedBytes: number,
  totalBytes: number
): BrowserDownloadState {
  return {
    id,
    url: `https://example.test/${id}`,
    filename: `${id}.bin`,
    state,
    receivedBytes,
    totalBytes,
    startedAt: '2026-08-22T00:00:00.000Z'
  }
}

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(DownloadsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      downloads: [
        download('known', 'progressing', 50, 100),
        download('unknown', 'progressing', 25, 0),
        download('complete', 'completed', 100, 100)
      ],
      formatBytes: (bytes: number) => `${bytes} B`,
      formatPercent: (percent: number) => `${percent}%`,
      pauseDownload: vi.fn(async () => []),
      resumeDownload: vi.fn(async () => []),
      cancelDownload: vi.fn(async () => []),
      clearFinished: vi.fn(async () => []),
      showInFolder: vi.fn(async () => undefined),
      ...overrides
    }
  })
}

describe('DownloadsPanel', () => {
  it('combines filters, counts retained rows, and clears finished entries hidden by the filter', async () => {
    const active = download('report', 'progressing', 1, 100)
    const clearFinished = vi.fn(async () => [active])
    renderPanel({ downloads: [active, download('visible', 'completed', 100, 100), download('hidden', 'cancelled', 0, 100)], clearFinished })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox', { name: 'Search filenames' }), 'VISIBLE')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter download status' }), 'finished')
    expect(screen.getByRole('status')).toHaveTextContent('1 of 3 downloads')
    expect(screen.queryByText('hidden.bin')).not.toBeInTheDocument()
    const clear = screen.getByRole('button', { name: 'Clear all finished' })
    expect(clear).toHaveAccessibleDescription('Clears all finished downloads, including those hidden by filters.')
    await user.click(clear)
    expect(clearFinished).toHaveBeenCalledWith()
    expect(screen.getByRole('status')).toHaveTextContent('0 of 1 downloads')
    expect(screen.getByText('No matching downloads')).toBeVisible()
    expect(screen.getByRole('searchbox')).toHaveFocus()
  })

  it.each(['cancel', 'external completion'])('keeps focus usable when %s removes an active row', async scenario => {
    const active = download('report', 'progressing', 1, 100)
    const view = renderPanel({ downloads: [active], cancelDownload: vi.fn(async () => [{ ...active, state: 'cancelled' as const }]) })
    const user = userEvent.setup()
    await user.selectOptions(screen.getByRole('combobox'), 'active')
    const cancel = screen.getByRole('button', { name: 'Cancel report.bin' })
    cancel.focus()
    if (scenario === 'cancel') await user.keyboard('{Enter}')
    else await view.rerender({ downloads: [{ ...active, state: 'completed' }] })
    await flushPromises()
    expect(screen.getByText('No matching downloads')).toBeVisible()
    expect(screen.getByRole('searchbox')).toHaveFocus()
    await user.selectOptions(screen.getByRole('combobox'), 'finished')
    expect(screen.getByText('report.bin')).toBeVisible()
  })

  it('does not steal filter focus when a transfer operation finishes after the filter changes', async () => {
    let finish!: (entries: BrowserDownloadState[]) => void
    renderPanel({ cancelDownload: vi.fn(() => new Promise(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    screen.getByRole('button', { name: 'Cancel known.bin' }).focus()
    await user.keyboard('{Enter}')
    const status = screen.getByRole('combobox')
    await user.selectOptions(status, 'finished')
    finish([download('known', 'cancelled', 50, 100)])
    await flushPromises()
    expect(status).toHaveFocus()
    expect(status).toHaveValue('finished')
    expect(screen.getByRole('status')).toHaveTextContent('1 of 1 downloads')
  })

  it('resets filters on reopen and ignores an older cancellation result', async () => {
    let finish!: (entries: BrowserDownloadState[]) => void
    const view = renderPanel({ cancelDownload: vi.fn(() => new Promise(resolve => { finish = resolve })) })
    const user = userEvent.setup()
    await user.type(screen.getByRole('searchbox'), 'known')
    await user.selectOptions(screen.getByRole('combobox'), 'active')
    await user.click(screen.getByRole('button', { name: 'Cancel known.bin' }))
    await view.rerender({ open: false })
    await view.rerender({ open: true })
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getByRole('combobox')).toHaveValue('all')
    const search = screen.getByRole('searchbox')
    await user.type(search, 'complete')
    finish([download('known', 'cancelled', 0, 100)])
    await flushPromises()
    expect(search).toHaveFocus()
    expect(search).toHaveValue('complete')
    expect(screen.getByText('complete.bin')).toBeVisible()
  })

  it.each(['pause', 'resume'] as const)('keeps keyboard focus on the replacement control after %s', async action => {
    const initial = { ...download('active', 'progressing', 25, 100), paused: action === 'resume', canResume: action === 'resume' }
    const result = { ...initial, paused: action === 'pause', canResume: action === 'pause' }
    const operation = vi.fn(async () => [result])
    renderPanel({ downloads: [initial], [`${action}Download`]: operation })
    const button = screen.getByRole('button', { name: `${action === 'pause' ? 'Pause' : 'Resume'} active.bin` })
    button.focus()
    await userEvent.keyboard('{Enter}')
    expect(operation).toHaveBeenCalledWith('active')
    expect(screen.getByRole('button', { name: `${action === 'pause' ? 'Resume' : 'Pause'} active.bin` })).toHaveFocus()
  })

  it('keeps the failed transfer control reachable for retry', async () => {
    renderPanel({ pauseDownload: vi.fn(async () => { throw new Error('Pause failed') }) })
    const pause = screen.getByRole('button', { name: 'Pause known.bin' })
    pause.focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('Pause failed')
    expect(pause).toHaveFocus()
    expect(pause).toBeEnabled()
  })

  it.each(['completed', 'cancelled'] as const)('keeps keyboard access when the transfer becomes %s during an action', async state => {
    renderPanel({ pauseDownload: vi.fn(async () => [download('known', state, 100, 100)]) })
    screen.getByRole('button', { name: 'Pause known.bin' }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: state === 'completed' ? 'Show known.bin in folder' : 'Close downloads' })).toHaveFocus()
  })

  it.each(['newer-focus', 'reopen', 'unmount', 'unfocused'] as const)('does not restore outdated transfer focus after %s', async scenario => {
    let finish!: (entries: BrowserDownloadState[]) => void
    const view = renderPanel({ pauseDownload: vi.fn(() => new Promise<BrowserDownloadState[]>(resolve => { finish = resolve })) })
    const pause = screen.getByRole('button', { name: 'Pause known.bin' })
    if (scenario === 'unfocused') pause.click()
    else { pause.focus(); await userEvent.keyboard('{Enter}') }
    let newer: HTMLElement | undefined
    if (scenario === 'newer-focus') { newer = screen.getByRole('button', { name: 'Close downloads' }); newer.focus() }
    if (scenario === 'reopen') { await view.rerender({ open: false }); await view.rerender({ open: true }) }
    if (scenario === 'unmount') view.unmount()
    finish([{ ...download('known', 'progressing', 50, 100), paused: true, canResume: true }])
    await flushPromises()
    expect(newer ?? document.body).toHaveFocus()
  })

  it('explains destination setup failures and offers only finished cleanup', () => {
    renderPanel({ downloads: [{ ...download('failed', 'interrupted', 0, 100), failureReason: 'destination-unavailable', completedAt: '2026-08-22T00:01:00.000Z' }] })
    expect(screen.getByText('Could not prepare download destination')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Clear all finished' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Resume failed.bin' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel failed.bin' })).toBeNull()
  })

  it('shows a paused transfer without a spinner and resumes it from the keyboard', async () => {
    const resumeDownload = vi.fn(async () => [])
    const view = renderPanel({ downloads: [{ ...download('paused', 'progressing', 25, 100), paused: true, canResume: true }], resumeDownload })
    expect(screen.getByText('Paused · 25% · 25 B of 100 B')).toBeVisible()
    expect(view.container.querySelector('.state-spinner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Clear all finished' })).toBeDisabled()
    const resume = screen.getByRole('button', { name: 'Resume paused.bin' })
    resume.focus()
    await userEvent.keyboard('{Enter}')
    expect(resumeDownload).toHaveBeenCalledWith('paused')
  })

  it('offers pause for active transfers and resume only for resumable interruptions', async () => {
    const pauseDownload = vi.fn(async () => [])
    renderPanel({ downloads: [download('active', 'progressing', 10, 100), { ...download('partial', 'interrupted', 25, 100), canResume: true }, { ...download('failed', 'interrupted', 25, 100), completedAt: '2026-08-22T00:01:00.000Z', canResume: false }], pauseDownload })
    expect(screen.getByRole('button', { name: 'Resume partial.bin' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Resume failed.bin' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Pause active.bin' }))
    expect(pauseDownload).toHaveBeenCalledWith('active')
  })

  it('keeps a resumable interruption cancellable and out of finished cleanup', async () => {
    const cancelDownload = vi.fn(async () => [])
    renderPanel({ downloads: [download('partial', 'interrupted', 25, 100)], cancelDownload })
    expect(screen.getByRole('button', { name: 'Clear all finished' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel partial.bin' }))
    expect(cancelDownload).toHaveBeenCalledWith('partial')
  })

  it('allows clearing a terminal interruption without offering cancellation', () => {
    renderPanel({ downloads: [{ ...download('partial', 'interrupted', 25, 100), completedAt: '2026-08-22T00:01:00.000Z' }] })
    expect(screen.getByRole('button', { name: 'Clear all finished' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Cancel partial.bin' })).not.toBeInTheDocument()
  })

  it('renders determinate and indeterminate progress accessibly', () => {
    renderPanel()

    expect(screen.getByRole('dialog', { name: 'Downloads' })).toBeVisible()
    expect(screen.getByRole('progressbar', { name: 'Downloading known.bin' })).toHaveAttribute('aria-valuenow', '50')
    expect(screen.getByRole('progressbar', { name: 'Downloading unknown.bin' })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByText('25 B downloaded')).toBeVisible()
    expect(screen.getByText('100 B · Complete')).toBeVisible()
  })

  it('shows clear-finished failures in the panel and allows retrying', async () => {
    const clearFinished = vi.fn()
      .mockRejectedValueOnce(new Error('Could not clear download history'))
      .mockResolvedValueOnce([])
    renderPanel({ clearFinished })
    const user = userEvent.setup()
    const clear = screen.getByRole('button', { name: 'Clear all finished' })

    await user.click(clear)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not clear download history')
    expect(clear).toBeEnabled()
    await user.click(clear)

    expect(clearFinished).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('No downloads yet')).toBeVisible()
  })

  it('does not let an older action lock or report errors in a reopened panel', async () => {
    let rejectReveal!: (reason?: unknown) => void
    const reveal = new Promise<void>((_resolve, reject) => {
      rejectReveal = reject
    })
    const showInFolder = vi.fn(() => reveal)
    const view = renderPanel({ showInFolder })
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Show complete.bin in folder' }))
    expect(showInFolder).toHaveBeenCalledWith('complete')
    expect(screen.getByRole('button', { name: 'Show complete.bin in folder' })).toBeDisabled()

    await view.rerender({ open: false })
    expect(screen.queryByRole('dialog', { name: 'Downloads' })).not.toBeInTheDocument()
    await view.rerender({ open: true })

    const reopenedAction = screen.getByRole('button', { name: 'Show complete.bin in folder' })
    try {
      expect(reopenedAction).toBeEnabled()
    } finally {
      rejectReveal(new Error('Older reveal failed'))
    }
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  })
})
