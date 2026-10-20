import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkPanel from '../../src/renderer/src/components/NetworkPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserNetworkRequest, BrowserTabState } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

function activeTab(): BrowserTabState {
  return {
    id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
    canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
    preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
  }
}

const request: BrowserNetworkRequest = {
  id: 'request-1', url: 'https://example.test/api', method: 'GET', resourceType: 'fetch',
  startedAt: '2026-08-21T12:00:00.000Z', status: 200, detailsAvailable: true
}

// Chromium moves the focus of a control that becomes disabled to the document body; JSDOM keeps it there.
function emulateChromiumFocusFixup(): MutationObserver {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const control = record.target as HTMLElement
      if (control !== document.activeElement || !control.hasAttribute('disabled')) continue
      // JSDOM ignores blur() on a disabled control, so blur it the moment before it is disabled.
      control.removeAttribute('disabled')
      control.blur()
      control.setAttribute('disabled', '')
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] })
  return observer
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderPanel(listNetworkRequests: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('hronaut', { listNetworkRequests, listNetworkRoutes: vi.fn(async () => []) })
  return render(NetworkPanel, {
    global,
    props: {
      open: true, dock: 'right', activeTab: activeTab(), locale: 'en-US', copyText: vi.fn(async () => true),
      syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
      preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
    }
  })
}

describe('Network panel focus after Clear', () => {
  // Clear is disabled once nothing is left to clear, so Chromium moved its focus to the document body: after clearing
  // the log with the keyboard, the next Tab started at the top of the window.
  it('moves the focus to the request filter once Clear empties the log', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const listNetworkRequests = vi.fn(async (_tabId: string, _clear?: boolean) => [request])
    const view = renderPanel(listNetworkRequests)
    const observer = emulateChromiumFocusFixup()
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Refresh network requests' }))
      await within(screen.getByRole('listbox', { name: 'Network requests' })).findByRole('option')
      const clear = screen.getByRole('button', { name: 'Clear' })
      await user.click(clear)
      await vi.waitFor(() => expect(clear).toBeDisabled())
      expect(listNetworkRequests).toHaveBeenLastCalledWith('tab-1', true)
      await vi.waitFor(() => expect(screen.getByRole('searchbox', { name: 'Filter network requests' })).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  it('leaves the focus alone when Clear empties the log while the window is in the background', async () => {
    const hasFocus = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const listNetworkRequests = vi.fn(async (_tabId: string, _clear?: boolean) => [request])
    const view = renderPanel(listNetworkRequests)
    const observer = emulateChromiumFocusFixup()
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'Refresh network requests' }))
      await within(screen.getByRole('listbox', { name: 'Network requests' })).findByRole('option')
      hasFocus.mockReturnValue(false)
      const clear = screen.getByRole('button', { name: 'Clear' })
      await user.click(clear)
      await vi.waitFor(() => expect(clear).toBeDisabled())
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(document.body).toHaveFocus()
    } finally { observer.disconnect(); view.unmount() }
  })
})

describe('Network panel Replay XHR confirmation', () => {
  async function showPostReplay(replayNetworkRequest: ReturnType<typeof vi.fn>) {
    const post: BrowserNetworkRequest = { ...request, id: 'post-1', method: 'POST', resourceType: 'xhr' }
    vi.stubGlobal('hronaut', {
      listNetworkRequests: vi.fn(async () => [post]),
      listNetworkRoutes: vi.fn(async () => []),
      getNetworkRequestDetails: vi.fn(async () => ({ ...post, request: { headers: {} }, response: { headers: {}, body: { available: true, text: '{}' } } })),
      replayNetworkRequest
    })
    const view = render(NetworkPanel, {
      global,
      props: {
        open: true, dock: 'right', activeTab: activeTab(), locale: 'en-US', copyText: vi.fn(async () => true),
        syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
        preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
      }
    })
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Refresh network requests' }))
    await user.click(await within(screen.getByRole('listbox', { name: 'Network requests' })).findByRole('option'))
    return { view, user, replay: await screen.findByRole('button', { name: 'Replay XHR' }) }
  }

  // Replaying a POST takes a second press, since it can repeat a write; the first press turns the button into Confirm
  // replay and leaves it focused, so a held Enter's repeats replayed it without one.
  it('asks for a new press to confirm a replay, not a held Enter\'s repeats', async () => {
    const replayNetworkRequest = vi.fn(async () => { throw new Error('Replay is not expected') })
    const { view, user, replay } = await showPostReplay(replayNetworkRequest)
    try {
      replay.focus()
      // Pressed once, then repeated three times while held.
      await user.keyboard('{Enter>4/}')
      expect(replay).toHaveTextContent('Confirm replay POST')
      expect(replay).toHaveFocus()
      expect(replayNetworkRequest).not.toHaveBeenCalled()
    } finally { view.unmount() }
  })

  it('takes a new click to confirm, not the second click of a double-click', async () => {
    const replayNetworkRequest = vi.fn(async () => new Promise(() => undefined))
    const { view, user, replay } = await showPostReplay(replayNetworkRequest)
    try {
      await user.dblClick(replay)
      expect(replay).toHaveTextContent('Confirm replay POST')
      expect(replayNetworkRequest).not.toHaveBeenCalled()
      await user.click(replay)
      expect(replayNetworkRequest).toHaveBeenCalledExactlyOnceWith('tab-1', 'post-1', true)
    } finally { view.unmount() }
  })
})
