import { fireEvent, render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { nextTick, ref, type Ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TabSearchPanel from '../../src/renderer/src/components/TabSearchPanel.vue'
import { useTabSearchController } from '../../src/renderer/src/composables/useTabSearchController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import UiMenu from '../../src/renderer/src/ui/UiMenu.vue'
import type { BrowserState, BrowserTabOverviewPreview, BrowserTabState } from '../../src/shared/types.js'

// Regression coverage for the renderer side of #865 (tabs overview thumbnails and the card menu), deferred to the
// redesign QA pass.

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    navigationGeneration: 1,
    title: `Tab ${id}`,
    url: `https://${id}.example`,
    loading: false,
    canGoBack: false,
    canGoForward: false,
    active: false,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    ...overrides
  }
}

function browserState(tabs: BrowserTabState[]): BrowserState {
  return {
    tabs,
    closedTabs: [],
    activeTabId: tabs.find((candidate) => candidate.active)?.id ?? null,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function frame(tabId: string, navigationGeneration: number, sleeping = false): BrowserTabOverviewPreview {
  return {
    tabId,
    navigationGeneration,
    dataUrl: sleeping ? 'data:image/jpeg;base64,a2VwdA==' : 'data:image/jpeg;base64,bGl2ZQ==',
    width: 360,
    height: 225,
    ...(sleeping ? { sleeping: true as const } : {})
  }
}

function createController(initial: BrowserState) {
  const state: Ref<BrowserState> = ref(initial)
  const open = ref(false)
  const browser = {
    closeTab: vi.fn(async () => state.value),
    reopenClosedTab: vi.fn(async () => state.value),
    setTabPinned: vi.fn(async () => state.value),
    restoreSavedTabGroup: vi.fn(async () => state.value),
    deleteSavedTabGroup: vi.fn(async () => state.value),
    getTabOverviewPreviews: vi.fn(async (_tabIds: string[]): Promise<BrowserTabOverviewPreview[]> => [])
  }
  const controller = useTabSearchController({
    state,
    open,
    mcpActivityByTab: ref({}),
    browser,
    syncState: async (next) => { state.value = await Promise.resolve(next) },
    selectTab: vi.fn(async () => undefined),
    expandTabGroup: vi.fn(),
    translate: (key) => key,
    formatNumber: String,
    formatTime: String,
    describeEmulation: () => '',
    confirm: () => true,
    formatError: (_cause, fallback) => fallback,
    showError: vi.fn()
  })
  return { state, open, browser, controller }
}

/** A live refresh, as the overview does when the window gets focus back. */
function refresh(): void {
  window.dispatchEvent(new Event('focus'))
}

describe('tab overview sleeping previews', () => {
  it('asks for a sleeping tab until its kept frame arrives, then leaves it out of later refreshes', async () => {
    const awake = tab('awake', { active: true })
    const sleeping = tab('sleeping', { sleeping: true, navigationGeneration: 2 })
    const { browser, controller } = createController(browserState([awake, sleeping]))
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(1))
      expect(browser.getTabOverviewPreviews).toHaveBeenLastCalledWith(['awake', 'sleeping'])
      await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))

      browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('sleeping', 2, true)])
      refresh()
      await vi.waitFor(() => expect(controller.previewForTab(sleeping)?.dataUrl).toBe('data:image/jpeg;base64,a2VwdA=='))
      expect(browser.getTabOverviewPreviews).toHaveBeenLastCalledWith(['awake', 'sleeping'])

      refresh()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(3))
      expect(browser.getTabOverviewPreviews).toHaveBeenLastCalledWith(['awake'])
      await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))
      // The kept frame stays while the tab sleeps, although later refreshes no longer ask for it.
      expect(controller.previewForTab(sleeping)).toBeDefined()
    } finally {
      controller.dispose()
    }
  })

  it('keeps asking for a sleeping tab outside the bounded live-refresh rotation', async () => {
    const tabs = [
      ...Array.from({ length: 6 }, (_, index) => tab(`tab-${index}`, { active: index === 0 })),
      tab('sleeping', { sleeping: true })
    ]
    const { browser, controller } = createController(browserState(tabs))
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(1))
      expect(browser.getTabOverviewPreviews.mock.calls[0]?.[0]).toHaveLength(7)
      await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))

      refresh()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))
      const requested = browser.getTabOverviewPreviews.mock.calls[1]?.[0] ?? []
      expect(requested).toHaveLength(5)
      expect(requested).toContain('tab-0')
      expect(requested.at(-1)).toBe('sleeping')
    } finally {
      controller.dispose()
    }
  })

  it('drops the kept frame as soon as the tab wakes and does not keep it after the next refresh', async () => {
    const sleeping = tab('sleeping', { sleeping: true, navigationGeneration: 2 })
    const { state, browser, controller } = createController(browserState([tab('awake', { active: true }), sleeping]))
    browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('sleeping', 2, true)])
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(controller.previewForTab(sleeping)).toBeDefined())

      const woken = { ...sleeping, sleeping: false }
      state.value = { ...state.value, tabs: [state.value.tabs[0], woken] }
      expect(controller.previewForTab(woken)).toBeUndefined()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))

      expect(controller.previewsByTab.value).not.toHaveProperty('sleeping')
    } finally {
      controller.dispose()
    }
  })

  it('drops the kept frame of a tab that closed', async () => {
    const sleeping = tab('sleeping', { sleeping: true })
    const { state, browser, controller } = createController(browserState([tab('awake', { active: true }), sleeping]))
    browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('sleeping', 1, true)])
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(controller.previewsByTab.value).toHaveProperty('sleeping'))

      state.value = { ...state.value, tabs: [state.value.tabs[0]] }
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))
      await vi.waitFor(() => expect(controller.previewLoading.value).toBe(false))

      expect(controller.previewsByTab.value).not.toHaveProperty('sleeping')
    } finally {
      controller.dispose()
    }
  })

  it('drops the kept frames when the only tab left is gone, without asking main', async () => {
    const sleeping = tab('sleeping', { sleeping: true, active: true })
    const { state, browser, controller } = createController(browserState([sleeping]))
    browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('sleeping', 1, true)])
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(controller.previewsByTab.value).toHaveProperty('sleeping'))

      state.value = { ...state.value, tabs: [], activeTabId: null }
      await vi.waitFor(() => expect(controller.previewsByTab.value).toEqual({}))
      expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(1)
    } finally {
      controller.dispose()
    }
  })

  it('does not show an old kept frame after the tab woke, navigated and slept again', async () => {
    const sleeping = tab('sleeping', { sleeping: true, navigationGeneration: 2 })
    const { state, browser, controller } = createController(browserState([tab('awake', { active: true }), sleeping]))
    browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('sleeping', 2, true)])
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(controller.previewForTab(sleeping)).toBeDefined())

      const resleeping = { ...sleeping, navigationGeneration: 3 }
      state.value = { ...state.value, tabs: [state.value.tabs[0], resleeping] }
      expect(controller.previewForTab(resleeping)).toBeUndefined()
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalledTimes(2))
      expect(browser.getTabOverviewPreviews).toHaveBeenLastCalledWith(['awake', 'sleeping'])
    } finally {
      controller.dispose()
    }
  })

  it('never shows a kept frame for a tab that is awake', async () => {
    const awake = tab('awake', { active: true })
    const background = tab('background')
    const { browser, controller } = createController(browserState([awake, background]))
    browser.getTabOverviewPreviews.mockResolvedValueOnce([frame('background', 1, true), frame('awake', 1)])
    try {
      await controller.openPanel()
      await vi.waitFor(() => expect(controller.previewForTab(awake)).toBeDefined())

      expect(controller.previewForTab(background)).toBeUndefined()
      expect(controller.previewsByTab.value).not.toHaveProperty('background')
    } finally {
      controller.dispose()
    }
  })
})

const originalHronaut = Object.getOwnPropertyDescriptor(window, 'hronaut')

afterEach(() => {
  if (originalHronaut) Object.defineProperty(window, 'hronaut', originalHronaut)
  else Reflect.deleteProperty(window, 'hronaut')
})

function renderPanel(state: BrowserState, previews: BrowserTabOverviewPreview[] = []) {
  const browser = {
    closeTab: vi.fn(async () => state),
    reopenClosedTab: vi.fn(async () => state),
    setTabPinned: vi.fn(async () => state),
    restoreSavedTabGroup: vi.fn(async () => state),
    deleteSavedTabGroup: vi.fn(async () => state),
    getTabOverviewPreviews: vi.fn(async () => previews),
    getTabOverviewPagePreview: vi.fn(async () => { throw new Error('not used') })
  }
  Object.defineProperty(window, 'hronaut', { configurable: true, value: browser })
  const view = render(TabSearchPanel, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      open: true,
      state,
      mcpActivityByTab: {},
      syncState: vi.fn(async () => undefined),
      selectTab: vi.fn(async () => undefined),
      expandTabGroup: vi.fn(),
      describeEmulation: () => '',
      formatNumber: String,
      formatTime: String,
      formatError: (_cause: unknown, fallback: string) => fallback,
      showError: vi.fn()
    }
  })
  return { view, browser }
}

function card(title: string): HTMLElement {
  const element = screen.getByText(title, { selector: 'strong' }).closest<HTMLElement>('.tab-overview-card')
  expect(element).not.toBeNull()
  return element!
}

describe('TabSearchPanel thumbnails and card menu', () => {
  it('shows a sleeping tab\'s kept frame dimmed under a Sleeping badge', async () => {
    const { view } = renderPanel(
      browserState([tab('alpha', { sleeping: true }), tab('beta', { active: true })]),
      [frame('alpha', 1, true)]
    )
    try {
      const alpha = card('Tab alpha')
      await vi.waitFor(() => expect(alpha.querySelector('.tab-overview-preview > img')).toHaveAttribute('src', 'data:image/jpeg;base64,a2VwdA=='))
      expect(alpha.querySelector('.tab-overview-preview')).toHaveClass('sleeping')
      expect(alpha.querySelector('.tab-overview-sleeping')).toHaveTextContent('Sleeping')
      expect(alpha.querySelector('.tab-overview-placeholder')).toBeNull()
      expect(card('Tab beta').querySelector('.tab-overview-sleeping')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('says a sleeping tab without a frame opens to preview, and a tab not shown yet has no preview', async () => {
    const { view, browser } = renderPanel(browserState([
      tab('alpha', { sleeping: true }),
      tab('gamma', { faviconDataUrl: 'data:image/png;base64,aWNvbg==' }),
      tab('beta', { active: true })
    ]))
    try {
      await vi.waitFor(() => expect(browser.getTabOverviewPreviews).toHaveBeenCalled())
      const alpha = card('Tab alpha')
      expect(within(alpha).getByText('Sleeping — open to preview')).toBeInTheDocument()
      expect(alpha.querySelector('.tab-overview-sleeping')).toBeNull()

      const gamma = card('Tab gamma')
      await vi.waitFor(() => expect(gamma.querySelector('.tab-overview-placeholder-site img')).toHaveAttribute('src', 'data:image/png;base64,aWNvbg=='))
      expect(within(gamma).getByText('No preview yet')).toBeInTheDocument()
      expect(within(gamma).getByText('gamma.example', { selector: '.tab-overview-placeholder strong' })).toBeInTheDocument()
      expect(gamma.querySelector('.tab-overview-preview > img')).toBeNull()
    } finally {
      view.unmount()
    }
  })

  it('offers Unpin for a pinned tab and no full-page preview for a sleeping or loading tab', async () => {
    const user = userEvent.setup()
    const { view } = renderPanel(browserState([
      tab('alpha', { sleeping: true, pinned: true }),
      tab('gamma', { loading: true }),
      tab('beta', { active: true })
    ]))
    try {
      await user.click(screen.getByRole('button', { name: 'More actions for Tab alpha' }))
      expect(screen.getByRole('menuitem', { name: 'Unpin tab' })).toBeEnabled()
      expect(screen.getByRole('menuitem', { name: 'Full-page preview' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'More actions for Tab gamma' }))
      expect(screen.getByRole('menuitem', { name: 'Pin tab' })).toBeEnabled()
      expect(screen.getByRole('menuitem', { name: 'Full-page preview' })).toBeDisabled()

      await user.click(screen.getByRole('button', { name: 'More actions for Tab beta' }))
      expect(screen.getByRole('menuitem', { name: 'Full-page preview' })).toBeEnabled()
    } finally {
      view.unmount()
    }
  })

  it('keeps one card menu open at a time and none when the overview opens again', async () => {
    const user = userEvent.setup()
    const { view } = renderPanel(browserState([tab('alpha'), tab('beta', { active: true })]))
    try {
      const alphaMore = screen.getByRole('button', { name: 'More actions for Tab alpha' })
      expect(alphaMore).toHaveAttribute('id', 'tab-card-menu-alpha')
      expect(alphaMore).toHaveAttribute('data-tooltip', 'More actions')
      await user.click(alphaMore)
      expect(screen.getByRole('menu', { name: 'More actions for Tab alpha' })).toBeVisible()

      await user.click(screen.getByRole('button', { name: 'More actions for Tab beta' }))
      expect(screen.getAllByRole('menu')).toHaveLength(1)
      expect(screen.getByRole('menu', { name: 'More actions for Tab beta' })).toBeVisible()
      expect(screen.getByRole('button', { name: 'More actions for Tab alpha' })).toHaveAttribute('aria-expanded', 'false')

      await view.rerender({ open: false })
      await view.rerender({ open: true })
      expect(screen.queryByRole('menu')).toBeNull()
      expect(screen.getByRole('button', { name: 'More actions for Tab beta' })).toHaveAttribute('aria-expanded', 'false')
    } finally {
      view.unmount()
    }
  })
})

function renderMenu(props: Record<string, unknown> = {}) {
  const view = render(UiMenu, {
    props: {
      open: false,
      label: 'More actions for Tab alpha',
      items: [{ id: 'pin', label: 'Pin tab' }, { id: 'preview', label: 'Full-page preview' }],
      ...props,
      'onUpdate:open': (open: boolean) => { void view.rerender({ open }) }
    }
  })
  return view
}

describe('UiMenu end alignment, trigger id, tooltip and closing', () => {
  it('lines its panel up with the trigger\'s end and names its trigger by id', () => {
    const view = renderMenu({ align: 'end', triggerId: 'tab-card-menu-alpha', tooltip: 'More actions' })
    const trigger = screen.getByRole('button', { name: 'More actions for Tab alpha' })

    expect(view.container.querySelector('.ui-menu')).toHaveClass('ui-menu--end')
    expect(trigger).toHaveAttribute('id', 'tab-card-menu-alpha')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
    view.unmount()
  })

  it('lines up with the trigger\'s start by default and adds no id', () => {
    const view = renderMenu()

    expect(view.container.querySelector('.ui-menu')).toHaveClass('ui-menu--start')
    expect(screen.getByRole('button', { name: 'More actions for Tab alpha' })).not.toHaveAttribute('id')
    view.unmount()
  })

  it('shows its tooltip only while closed', async () => {
    const view = renderMenu({ tooltip: 'More actions' })
    const trigger = screen.getByRole('button', { name: 'More actions for Tab alpha' })
    expect(trigger).toHaveAttribute('data-tooltip', 'More actions')

    await fireEvent.click(trigger)
    await screen.findByRole('menu')
    expect(trigger).not.toHaveAttribute('data-tooltip')

    await fireEvent.click(trigger)
    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(trigger).toHaveAttribute('data-tooltip', 'More actions')
    view.unmount()
  })

  it('closes when focus tabs out of it, but not when focus moves inside or leaves the window', async () => {
    const outside = document.createElement('button')
    document.body.append(outside)
    const view = renderMenu({ open: true })
    try {
      const [pin, preview] = await screen.findAllByRole('menuitem')
      await fireEvent.focusOut(pin, { relatedTarget: preview })
      await fireEvent.focusOut(pin, { relatedTarget: null })
      expect(view.emitted()['update:open']).toBeUndefined()

      await fireEvent.focusOut(pin, { relatedTarget: outside })
      expect(view.emitted()['update:open']).toEqual([[false]])
      await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    } finally {
      view.unmount()
      outside.remove()
    }
  })

  it('closes only the menu on Esc from its trigger, and lets Esc through while closed', async () => {
    const view = renderMenu({ open: true })
    const trigger = screen.getByRole('button', { name: 'More actions for Tab alpha' })
    const openEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })

    await fireEvent(trigger, openEscape)

    expect(openEscape.defaultPrevented).toBe(true)
    expect(view.emitted()['update:open']).toEqual([[false]])
    expect(trigger).toHaveFocus()
    await vi.waitFor(() => expect(screen.queryByRole('menu')).toBeNull())

    const closedEscape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await fireEvent(trigger, closedEscape)
    await nextTick()
    expect(closedEscape.defaultPrevented).toBe(false)
    expect(view.emitted()['update:open']).toEqual([[false]])
    view.unmount()
  })
})
