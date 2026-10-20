import { render, screen, within } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import NetworkPanel from '../../src/renderer/src/components/NetworkPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserNetworkRequest, BrowserTabState, PanelDock } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

const activeTab: BrowserTabState = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
}

const request: BrowserNetworkRequest = {
  id: 'request-1', url: 'https://example.test/api/while-detached', method: 'GET', resourceType: 'fetch',
  startedAt: '2026-08-21T12:00:00.000Z', status: 200, detailsAvailable: true
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it('reads the page’s requests when the panel docks back from its window', async () => {
  // The panel stayed open while it was in its own window, so docked back it showed the requests it had before it left.
  const listNetworkRequests = vi.fn(async () => [request])
  vi.stubGlobal('hronaut', { listNetworkRequests, listNetworkRoutes: vi.fn(async () => []) })
  const props = (dock: PanelDock) => ({
    open: true, dock, activeTab, locale: 'en-US' as const, copyText: vi.fn(async () => true),
    syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
    preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
  })
  const view = render(NetworkPanel, { global, props: props('window') })
  try {
    expect(listNetworkRequests).not.toHaveBeenCalled()
    await view.rerender(props('right'))
    await within(await screen.findByRole('listbox', { name: 'Network requests' })).findByRole('option')
    expect(listNetworkRequests).toHaveBeenCalledOnce()
    expect(listNetworkRequests).toHaveBeenCalledWith('tab-1', false)
    // Moving between docked places keeps what the panel shows.
    await view.rerender(props('left'))
    expect(listNetworkRequests).toHaveBeenCalledOnce()
  } finally { view.unmount() }
})
