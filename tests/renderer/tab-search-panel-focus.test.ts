import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabSearchPanel from '../../src/renderer/src/features/tabs/TabSearchPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserSavedTabGroupState, BrowserState, BrowserTabState } from '../../src/shared/types.js'

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function tab(id: string, active = false): BrowserTabState {
  return {
    id, navigationGeneration: 1, title: `Tab ${id}`, url: `https://${id}.example`, loading: false,
    canGoBack: false, canGoForward: false, active, pinned: false, sleeping: false, humanInteractionLocked: false,
    preserveDiagnosticLogs: false, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false
  }
}

function savedGroup(id: string): BrowserSavedTabGroupState {
  return {
    id, name: `Saved ${id}`, description: '', color: 'purple', savedAt: '2026-08-22T00:00:00.000Z',
    storageOriginCount: 0, navigationPolicy: { mode: 'unrestricted', rules: [] },
    tabs: [{ title: 'Saved page', url: 'https://saved.example', pinned: false }]
  }
}

function state(): BrowserState {
  return {
    tabs: [tab('alpha'), tab('beta', true)], closedTabs: [], activeTabId: 'beta', allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp', profilePath: '/profile', mcpTabGroups: [], savedTabGroups: [savedGroup('archive')]
  }
}

// JSDOM keeps focus on a control that becomes disabled; Chromium moves it to the document body.
function dropFocusLikeChromium(control: HTMLElement): void {
  control.removeAttribute('disabled')
  control.blur()
  control.setAttribute('disabled', '')
  expect(document.body).toHaveFocus()
}

const previousHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  vi.restoreAllMocks()
  if (previousHronaut) Object.defineProperty(window, 'hronaut', previousHronaut)
  else Reflect.deleteProperty(window, 'hronaut')
})

function renderPanel(browserState = state()) {
  const pending = deferred<BrowserState>()
  const browser = {
    closeTab: vi.fn(() => pending.promise),
    reopenClosedTab: vi.fn(async () => browserState),
    setTabPinned: vi.fn(async () => browserState),
    restoreSavedTabGroup: vi.fn(() => pending.promise),
    deleteSavedTabGroup: vi.fn(() => pending.promise),
    getTabOverviewPreviews: vi.fn(async () => [])
  }
  Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const showError = vi.fn()
  const view = render(TabSearchPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true, state: browserState, mcpActivityByTab: {},
      syncState: async (next: Promise<BrowserState> | BrowserState) => { await next },
      selectTab: vi.fn(async () => undefined), expandTabGroup: vi.fn(), describeEmulation: () => '',
      formatNumber: String, formatTime: String,
      formatError: (_cause: unknown, fallback: string) => fallback, showError
    }
  })
  return { browser, pending, showError, view }
}

describe('TabSearchPanel focus after a failed action', () => {
  // The overview disabled every action while one ran, Chromium moved the focus of the one you used to the
  // document body, and only a success put it back: after a failure the next Tab started outside the dialog.
  it.each([
    ['Close Tab alpha', 'closeTab'],
    ['Delete archived workspace Saved archive', 'deleteSavedTabGroup'],
    ['Restore archived workspace Saved archive', 'restoreSavedTabGroup']
  ] as const)('gives the focus back after %s fails', async (name, method) => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { browser, pending, showError, view } = renderPanel()
    try {
      const button = screen.getByRole('button', { name })
      await userEvent.setup().click(button)
      expect(browser[method]).toHaveBeenCalledOnce()
      expect(button).toBeDisabled()
      dropFocusLikeChromium(button)
      pending.reject(new Error('refused'))
      await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(button).toBeEnabled())
      await vi.waitFor(() => expect(document.body).not.toHaveFocus())
      expect(screen.getByRole('dialog', { name: 'Tabs' })).toContainElement(document.activeElement as HTMLElement)
      expect(button).toHaveFocus()
    } finally {
      view.unmount()
    }
  })

  it('leaves newer focus alone when a failed close settles', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { pending, showError, view } = renderPanel()
    try {
      const button = screen.getByRole('button', { name: 'Close Tab alpha' })
      await userEvent.setup().click(button)
      dropFocusLikeChromium(button)
      const panelClose = screen.getByRole('button', { name: 'Close tab search' })
      panelClose.focus()
      pending.reject(new Error('refused'))
      await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(button).toBeEnabled())
      expect(panelClose).toHaveFocus()
    } finally {
      view.unmount()
    }
  })

  it('does not take the focus while Hronaut is in the background', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    const { pending, showError, view } = renderPanel()
    try {
      const button = screen.getByRole('button', { name: 'Close Tab alpha' })
      await userEvent.setup().click(button)
      dropFocusLikeChromium(button)
      pending.reject(new Error('refused'))
      await vi.waitFor(() => expect(showError).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(button).toBeEnabled())
      expect(document.body).toHaveFocus()
    } finally {
      view.unmount()
    }
  })
})

describe('TabSearchPanel page preview return focus', () => {
  // Alt+Enter in the search field opened the preview of the selected tab, but Back to tabs always focused that card's
  // More actions button, as if the preview had been opened from its menu: typing and arrow keys no longer reached the
  // search field you came from.
  it('returns to the search field after a preview opened from it with Alt+Enter', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { browser, view } = renderPanel()
    Object.assign(browser, {
      getTabOverviewPagePreview: vi.fn(async (tabId: string) => ({
        tabId, navigationGeneration: 1, dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000
      }))
    })
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('searchbox', { name: 'Search tabs' }))
      await user.keyboard('{Alt>}{Enter}{/Alt}')
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to tabs' })).toHaveFocus())
      await user.keyboard('{Escape}')
      await vi.waitFor(() => expect(screen.getByRole('searchbox', { name: 'Search tabs' })).toHaveFocus())
      expect(screen.getByRole('searchbox', { name: 'Search tabs' })).toHaveAttribute('aria-activedescendant', 'tab-search-open-beta')
    } finally {
      view.unmount()
    }
  })

  it('still returns to the card menu after a preview opened from it', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const { browser, view } = renderPanel()
    Object.assign(browser, {
      getTabOverviewPagePreview: vi.fn(async (tabId: string) => ({
        tabId, navigationGeneration: 1, dataUrl: 'data:image/jpeg;base64,YWJj', width: 1000, height: 4000
      }))
    })
    try {
      const user = userEvent.setup()
      await user.click(screen.getByRole('button', { name: 'More actions for Tab alpha' }))
      await user.click(screen.getByRole('menuitem', { name: 'Full-page preview' }))
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Back to tabs' })).toHaveFocus())
      await user.keyboard('{Escape}')
      await vi.waitFor(() => expect(screen.getByRole('button', { name: 'More actions for Tab alpha' })).toHaveFocus())
    } finally {
      view.unmount()
    }
  })
})
