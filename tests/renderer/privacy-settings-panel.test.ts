import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PrivacySettingsPanel from '../../src/renderer/src/components/PrivacySettingsPanel.vue'
import { usePrivacySettingsController } from '../../src/renderer/src/composables/usePrivacySettingsController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowsingDataSummary, BrowsingDataWebsiteSummary } from '../../src/shared/types.js'

const EMPTY_SUMMARY: BrowsingDataSummary = {
  historyEntries: 0,
  historyVisits: 0,
  bookmarkCount: 0,
  savedPasswordCount: 0,
  permissionDecisionCount: 0
}

function website(hostname: string): BrowsingDataWebsiteSummary {
  return {
    origin: `https://${hostname}`,
    hostname,
    title: `Title for ${hostname}`,
    cookieCount: 1,
    historyEntries: 1,
    historyVisits: 2,
    bookmarkCount: 0,
    savedPasswordCount: 0,
    permissionDecisionCount: 0,
    openTabCount: 0
  }
}

function renderPanel() {
  const api = {
    summary: vi.fn(async () => EMPTY_SUMMARY),
    websites: vi.fn(async () => [website('refreshed.test')]),
    clear: vi.fn(async () => EMPTY_SUMMARY)
  }
  const controller = usePrivacySettingsController({
    api,
    confirm: () => true,
    formatNumber: String,
    translate: (key) => key
  })
  controller.summary.value = EMPTY_SUMMARY
  controller.websites.value = [website('example.test')]
  const view = render(PrivacySettingsPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      controller,
      workspaces: [
        { id: 'active', name: 'Research', archived: false, tabCount: 2, storageOriginCount: 3 },
        { id: 'archived', name: 'Released task', archived: true, tabCount: 1, storageOriginCount: 1 }
      ],
      formatBytes: (bytes) => `${bytes} B`,
      formatNumber: String
    }
  })
  return { api, controller, view }
}

describe('PrivacySettingsPanel', () => {
  it('renders and filters websites through the extracted controller', async () => {
    const { controller } = renderPanel()
    const user = userEvent.setup()

    expect(screen.getByRole('heading', { name: 'Workspaces & data' })).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Global history' })).toBeVisible()
    expect(screen.getByText('Research')).toBeVisible()
    expect(screen.getByText(/Active · 2 tabs · 3 known websites/)).toBeVisible()
    expect(screen.getByText('example.test')).toBeVisible()
    await user.type(screen.getByRole('searchbox', { name: 'Search websites' }), 'missing')

    expect(screen.getByText('No matching websites')).toBeVisible()
    controller.dispose()
  })

  it('opens workspace management and the shared transfer workflow', async () => {
    const { controller, view } = renderPanel()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Manage' }))
    expect(view.emitted('manageWorkspace')).toEqual([['active']])

    await user.click(screen.getAllByRole('button', { name: 'Copy or move data' })[1])
    expect(view.emitted('transferWorkspaceData')).toEqual([['archived']])

    await user.click(screen.getByRole('button', { name: 'Create workspace' }))
    expect(view.emitted('createWorkspace')).toHaveLength(1)
    controller.dispose()
  })

  it('blocks refresh and clear controls for the full duration of a clear operation', async () => {
    const { controller } = renderPanel()

    controller.summaryState.value = 'clearing'
    await nextTick()

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clearing all…' })).toBeDisabled()
    expect(screen.getByRole('group', { name: 'What to clear' })).toBeDisabled()
    controller.dispose()
  })
})
