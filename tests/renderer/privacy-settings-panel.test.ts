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

function renderPanel(entries = [website('example.test')]) {
  const api = {
    summary: vi.fn(async () => EMPTY_SUMMARY),
    websites: vi.fn(async () => [website('refreshed.test')]),
    clear: vi.fn(async () => EMPTY_SUMMARY)
  }
  const confirm = vi.fn(() => true)
  const controller = usePrivacySettingsController({
    api,
    confirm,
    formatNumber: String,
    translate: (key) => key
  })
  controller.summary.value = EMPTY_SUMMARY
  controller.websites.value = entries
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
  return { api, controller, view, confirm }
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
    expect(screen.getByRole('button', { name: 'Clear history for https://example.test' })).toHaveAttribute('aria-disabled', 'true')
    controller.dispose()
  })
})

const sites = ['first.test', 'middle.test', 'third.test'].map(website)
const clearName = (site: BrowsingDataWebsiteSummary) => `Clear history for ${site.origin}`

it.each([0, 1, 2])('keeps keyboard position after clearing website row %i', async index => {
  const { api, controller } = renderPanel(sites)
  api.websites.mockResolvedValueOnce(sites.filter((_, i) => i !== index))
  await userEvent.setup().click(screen.getByRole('button', { name: clearName(sites[index]) }))
  const neighbor = sites[index === 2 ? 1 : index + 1]
  await vi.waitFor(() => expect(screen.getByRole('button', { name: clearName(neighbor) })).toHaveFocus())
  expect(api.clear).toHaveBeenCalledExactlyOnceWith({ history: true, origin: sites[index].origin })
  controller.dispose()
})

it('focuses Global history after its final website row disappears', async () => {
  const { api, controller } = renderPanel([sites[0]])
  api.websites.mockResolvedValueOnce([])
  await userEvent.setup().click(screen.getByRole('button', { name: clearName(sites[0]) }))
  await vi.waitFor(() => expect(screen.getByRole('heading', { name: 'Global history' })).toHaveFocus())
  expect(screen.getByText('No websites yet')).toBeVisible()
  controller.dispose()
})

it('keeps a pending site clear reachable, rejects repeated activation and retains focus after failure', async () => {
  const { api, controller, confirm } = renderPanel(sites)
  let reject!: (error: Error) => void
  api.clear.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  const user = userEvent.setup()
  const button = screen.getByRole('button', { name: clearName(sites[1]) })
  await user.click(button)
  const disabledWhilePending = button.hasAttribute('disabled')
  const busyWhilePending = button.getAttribute('aria-disabled')
  await user.keyboard('{Enter}')
  reject(new Error('Synthetic clear failure'))
  await vi.waitFor(() => expect(controller.websiteState.value).toBe('error'))
  expect(api.clear).toHaveBeenCalledOnce()
  expect(confirm).toHaveBeenCalledOnce()
  expect(disabledWhilePending).toBe(false)
  expect(busyWhilePending).toBe('true')
  expect(button).toHaveFocus()
  expect(button).toHaveAttribute('aria-disabled', 'false')
  controller.dispose()
})

it('keeps a newer search focused when a pending site clear finishes', async () => {
  const { api, controller } = renderPanel(sites)
  let resolve!: (summary: BrowsingDataSummary) => void
  api.clear.mockReturnValueOnce(new Promise(done => { resolve = done }))
  api.websites.mockResolvedValueOnce([sites[0], sites[2]])
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: clearName(sites[1]) }))
  const search = screen.getByRole('searchbox', { name: 'Search websites' })
  await user.type(search, 'third')
  resolve(EMPTY_SUMMARY)
  await vi.waitFor(() => expect(controller.websites.value).toHaveLength(2))
  expect(search).toHaveFocus()
  expect(search).toHaveValue('third')
  controller.dispose()
})

it('recovers focused website clear controls after a live inventory removal', async () => {
  const { controller } = renderPanel(sites)
  screen.getByRole('button', { name: clearName(sites[1]) }).focus()
  controller.websites.value = [sites[0], sites[2]]
  await vi.waitFor(() => expect(screen.getByRole('button', { name: clearName(sites[2]) })).toHaveFocus())
  controller.dispose()
})

it('keeps a retained website clear control focused when another row disappears', async () => {
  const { controller } = renderPanel(sites)
  const button = screen.getByRole('button', { name: clearName(sites[2]) })
  button.focus()
  controller.websites.value = [sites[0], sites[2]]
  await nextTick()
  expect(button).toHaveFocus()
  controller.dispose()
})

it('does not recover old website focus after the panel unmounts', async () => {
  const { api, controller, view } = renderPanel(sites)
  let resolve!: (summary: BrowsingDataSummary) => void
  api.clear.mockReturnValueOnce(new Promise(done => { resolve = done }))
  api.websites.mockResolvedValueOnce([sites[0], sites[2]])
  await userEvent.setup().click(screen.getByRole('button', { name: clearName(sites[1]) }))
  view.unmount()
  const newer = document.createElement('button')
  document.body.append(newer)
  newer.focus()
  resolve(EMPTY_SUMMARY)
  await vi.waitFor(() => expect(controller.websites.value).toHaveLength(2))
  expect(newer).toHaveFocus()
  newer.remove()
  controller.dispose()
})
