import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NetworkPanel from '../../src/renderer/src/features/network/NetworkPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserNetworkRouteSummary, BrowserState, BrowserTabState } from '../../src/shared/types.js'

const global = { plugins: [createHronautI18n('en-US')] }

function activeTab(networkRouteCount = 0): BrowserTabState {
  return {
    id: 'tab-1', title: 'Example', url: 'https://example.test/app', loading: false, navigationGeneration: 0,
    canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false,
    preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false, networkRouteCount
  }
}

function route(id: string, urlPattern: string): BrowserNetworkRouteSummary {
  return { id, urlPattern, enabled: true, behavior: 'abort', abort: 'Failed', remainingMatches: 1, createdAt: '2026-08-21T12:00:00.000Z' }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

// Chromium moves the focus of a control that becomes disabled to the document body; JSDOM keeps it there.
function emulateChromiumFocusFixup(): MutationObserver {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const control = record.target as HTMLElement
      if (control !== document.activeElement || !control.hasAttribute('disabled')) continue
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

async function renderPanel(api: Record<string, unknown>) {
  const first = route('route-1', 'https://api.example.test/one')
  const second = route('route-2', 'https://api.example.test/two')
  vi.stubGlobal('hronaut', {
    listNetworkRequests: vi.fn(async () => []),
    listNetworkRoutes: vi.fn(async () => [first, second]),
    getState: vi.fn(async () => ({}) as BrowserState),
    ...api
  })
  const view = render(NetworkPanel, {
    global,
    props: {
      open: true, dock: 'right', activeTab: activeTab(), locale: 'en-US', copyText: vi.fn(async () => true),
      syncState: vi.fn(async (operation: Promise<unknown>) => { await operation }),
      preservationBusy: false, updatePreservation: vi.fn(), keepsSeparatePanelOpen: () => false
    }
  })
  await view.rerender({ activeTab: activeTab(2) })
  await userEvent.setup().click(screen.getByRole('button', { name: /^Request conditions/ }))
  const list = await screen.findByLabelText('Request conditions', { selector: '.request-condition-list' })
  await within(list).findByText('https://api.example.test/two')
  return { view, first, second }
}

describe('Request conditions focus after a change', () => {
  // Every condition control is disabled while a change applies, so Chromium moved the focus of the one you used to the
  // document body: the next Tab started at the top of the window, and the next arrow key or Enter did nothing.
  it('gives the focus back to Move down once a rule moves and the button is enabled again', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const moved = deferred<BrowserNetworkRouteSummary[]>()
    const moveNetworkRoute = vi.fn(() => moved.promise)
    const { view, first, second } = await renderPanel({ moveNetworkRoute })
    const observer = emulateChromiumFocusFixup()
    try {
      // Three rules, so the first one can move down and still move down again.
      const third = route('route-3', 'https://api.example.test/three')
      const moveDown = screen.getByRole('button', { name: 'Move request condition https://api.example.test/one down' })
      await userEvent.setup().click(moveDown)
      await vi.waitFor(() => expect(moveDown).toBeDisabled())
      expect(document.body).toHaveFocus()
      moved.resolve([second, first, third])
      await vi.waitFor(() => expect(moveDown).toBeEnabled())
      await vi.waitFor(() => expect(moveDown).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  // A removed rule takes its button away. Not to another rule's Remove: a held Enter would remove that one too.
  it('keeps the focus in Request conditions once a rule is removed, never on another rule\'s button', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const removed = deferred<BrowserNetworkRouteSummary[]>()
    const removeNetworkRoute = vi.fn(() => removed.promise)
    const { view, second } = await renderPanel({ removeNetworkRoute })
    const observer = emulateChromiumFocusFixup()
    try {
      const remove = screen.getByRole('button', { name: 'Remove request condition https://api.example.test/one' })
      await userEvent.setup().click(remove)
      await vi.waitFor(() => expect(remove).toBeDisabled())
      expect(document.body).toHaveFocus()
      removed.resolve([second])
      await vi.waitFor(() => expect(remove).not.toBeInTheDocument())
      const section = view.container.querySelector<HTMLElement>('.request-conditions')!
      await vi.waitFor(() => expect(section).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  // Moving a rule to the top disables its Move up for good; Move down would move it straight back on a held Enter.
  it('keeps the focus in Request conditions once Move up stays disabled at the top', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const moved = deferred<BrowserNetworkRouteSummary[]>()
    const moveNetworkRoute = vi.fn(() => moved.promise)
    const { view, first, second } = await renderPanel({ moveNetworkRoute })
    const observer = emulateChromiumFocusFixup()
    try {
      const moveUp = screen.getByRole('button', { name: 'Move request condition https://api.example.test/two up' })
      await userEvent.setup().click(moveUp)
      await vi.waitFor(() => expect(moveUp).toBeDisabled())
      moved.resolve([second, first])
      const section = view.container.querySelector<HTMLElement>('.request-conditions')!
      await vi.waitFor(() => expect(section).toHaveFocus())
      expect(moveUp).toBeDisabled()
    } finally { observer.disconnect(); view.unmount() }
  })

  it('leaves newer focus alone when the change applies', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const moved = deferred<BrowserNetworkRouteSummary[]>()
    const moveNetworkRoute = vi.fn(() => moved.promise)
    const { view, first, second } = await renderPanel({ moveNetworkRoute })
    const observer = emulateChromiumFocusFixup()
    try {
      const moveDown = screen.getByRole('button', { name: 'Move request condition https://api.example.test/one down' })
      await userEvent.setup().click(moveDown)
      await vi.waitFor(() => expect(moveDown).toBeDisabled())
      const pattern = screen.getByRole('textbox', { name: 'URL pattern' })
      pattern.focus()
      moved.resolve([second, first])
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Move request condition https://api.example.test/one up' })).toBeEnabled())
      expect(pattern).toHaveFocus()
    } finally { observer.disconnect(); view.unmount() }
  })
})
