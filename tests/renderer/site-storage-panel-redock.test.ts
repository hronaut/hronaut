import { render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import SiteStoragePanel from '../../src/renderer/src/components/SiteStoragePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserStorageResult, BrowserTabState, PanelDock } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

const activeTab: BrowserTabState = {
  id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
  canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
  preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
}

const storage: BrowserStorageResult = {
  tabId: 'tab-1', url: 'https://example.test/app', origin: 'https://example.test', kind: 'local-storage', action: 'list',
  itemCount: 1, items: [{ key: 'while-detached', value: '1', valueBytes: 1 }]
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function props(dock: PanelDock, keepsSeparatePanelOpen: boolean) {
  return { open: true, dock, activeTab, locale: 'en-US' as const, copyText: vi.fn(async () => true), keepsSeparatePanelOpen: () => keepsSeparatePanelOpen }
}

it('reads the site’s storage when the panel docks back from its window', async () => {
  // The panel stayed open while it was in its own window, so docked back it showed the items it had before it left,
  // including ones deleted in the window.
  const manageStorage = vi.fn(async () => storage)
  vi.stubGlobal('hronaut', { manageStorage })
  const view = render(SiteStoragePanel, { global, props: props('window', false) })
  try {
    expect(manageStorage).not.toHaveBeenCalled()
    await view.rerender(props('right', false))
    expect(await screen.findByRole('button', { name: 'Delete while-detached' })).toBeTruthy()
    expect(manageStorage).toHaveBeenCalledOnce()
    expect(manageStorage).toHaveBeenCalledWith({ tabId: 'tab-1', kind: 'local-storage', action: 'list', includeValues: true })
    // Moving between docked places keeps what the panel shows.
    await view.rerender(props('left', false))
    expect(manageStorage).toHaveBeenCalledOnce()
  } finally { view.unmount() }
})

it('reads nothing in the panel window as it docks back and closes', async () => {
  const manageStorage = vi.fn(async () => storage)
  vi.stubGlobal('hronaut', { manageStorage })
  const view = render(SiteStoragePanel, { global, props: props('window', true) })
  try {
    await view.rerender(props('right', true))
    await Promise.resolve()
    expect(manageStorage).not.toHaveBeenCalled()
  } finally { view.unmount() }
})
