import { ref } from 'vue'
import { render, screen, waitFor } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import AppTopbarActions from '../../src/renderer/src/components/AppTopbarActions.vue'
import { useMcpStatusController } from '../../src/renderer/src/composables/useMcpStatusController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type {
  AppUpdateState,
  HronautMcpApi,
  BrowserDownloadState,
  McpControlState
} from '../../src/shared/types.js'

function download(index: number, state: BrowserDownloadState['state'] = 'completed'): BrowserDownloadState {
  return {
    id: `download-${index}`,
    url: `https://download.test/${index}`,
    filename: `${index}.bin`,
    state,
    receivedBytes: state === 'progressing' ? 50 : 100,
    totalBytes: 100,
    startedAt: '2026-08-23T00:00:00.000Z'
  }
}

function renderActions(overrides: Record<string, unknown> = {}) {
  const api: HronautMcpApi = {
    getState: vi.fn(async (): Promise<McpControlState> => ({ status: 'ready', paused: false })),
    setPaused: vi.fn(async (paused: boolean): Promise<McpControlState> => ({ status: paused ? 'paused' : 'ready', paused })),
    onChanged: vi.fn(() => () => undefined)
  }
  const mcpStatusController = useMcpStatusController({
    api,
    endpoint: ref('http://127.0.0.1:47812/mcp'),
    copyText: vi.fn(async () => true),
    onPauseError: vi.fn()
  })
  mcpStatusController.accept({ status: 'ready', paused: false })
  const updateState: AppUpdateState = { status: 'available', currentVersion: '1.7.3', availableVersion: '1.7.4' }
  const downloads = Array.from({ length: 101 }, (_, index) => download(index))
  const rendered = render(AppTopbarActions, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      commandPaletteOpen: false,
      tabSearchOpen: false,
      downloadsOpen: false,
      historyOpen: false,
      settingsOpen: false,
      downloads,
      activeDownloads: [download(200, 'progressing')],
      downloadButtonLabel: '1 download in progress',
      allInteractionLocked: false,
      allInteractionLockLabel: 'Lock all tabs',
      showUpdateStatus: true,
      updateState,
      mcpStatusController,
      ...overrides
    }
  })
  return { ...rendered, mcpStatusController }
}

describe('AppTopbarActions', () => {
  it('renders bounded download status and emits every shell action', async () => {
    const rendered = renderActions()
    const user = userEvent.setup()

    const downloads = screen.getByRole('button', { name: '1 download in progress' })
    expect(downloads).toHaveClass('active')
    expect(screen.getByText('99')).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Open command palette' }))
    await user.click(screen.getByRole('button', { name: 'Search tabs' }))
    await user.click(downloads)
    await user.click(screen.getByRole('button', { name: 'Browsing history' }))
    await user.click(screen.getByRole('button', { name: 'Lock all tabs' }))
    await user.click(screen.getByTitle('Open Software updates'))
    await user.click(screen.getByRole('button', { name: 'Settings' }))

    expect(rendered.emitted()).toMatchObject({
      toggleCommandPalette: [[]],
      toggleTabSearch: [[]],
      toggleDownloads: [[]],
      toggleHistory: [[]],
      toggleAllInteraction: [[]],
      openUpdateSettings: [[]],
      toggleSettings: [[]]
    })
    rendered.mcpStatusController.dispose()
  })

  it('focuses the lock after it activates and reflects completed downloads', async () => {
    const rendered = renderActions({
      downloads: [download(1)],
      activeDownloads: [],
      downloadButtonLabel: 'Download complete'
    })
    const completed = screen.getByRole('button', { name: 'Download complete' })
    expect(completed).toHaveClass('complete')

    await rendered.rerender({
      allInteractionLocked: true,
      allInteractionLockLabel: 'Unlock all tabs'
    })

    const lock = screen.getByRole('button', { name: 'Unlock all tabs' })
    await waitFor(() => expect(lock).toHaveFocus())
    expect(lock).toHaveAttribute('aria-pressed', 'true')
    rendered.mcpStatusController.dispose()
  })
})
