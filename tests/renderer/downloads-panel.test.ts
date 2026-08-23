import { render, screen } from '@testing-library/vue'
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
      cancelDownload: vi.fn(async () => []),
      clearFinished: vi.fn(async () => []),
      showInFolder: vi.fn(async () => undefined),
      ...overrides
    }
  })
}

describe('DownloadsPanel', () => {
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
    const clear = screen.getByRole('button', { name: 'Clear finished' })

    await user.click(clear)
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not clear download history')
    expect(clear).toBeEnabled()
    await user.click(clear)

    expect(clearFinished).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('No downloads yet')).toBeVisible()
  })
})
