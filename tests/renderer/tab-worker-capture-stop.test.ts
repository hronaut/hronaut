import { fireEvent, render } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BrowserTabsBar from '../../src/renderer/src/components/BrowserTabsBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

function workspace(): BrowserTabGroupState {
  return {
    id: 'workspace-1',
    name: 'Research',
    description: '',
    color: 'purple',
    createdAt: '2026-08-22T09:00:00.000Z',
    lastUsedAt: '2026-08-22T09:00:00.000Z',
    tabCount: 2,
    activeTabId: 'a',
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] }
  }
}

function tab(id: string, overrides: Partial<BrowserTabState> = {}): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
    loading: false,
    navigationGeneration: 0,
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
    mcpGroupId: 'workspace-1',
    mcpGroupName: 'Research',
    ...overrides
  }
}

function browserState(capturing: { a: boolean; b: boolean }): BrowserState {
  return {
    tabs: [tab('a', { active: true, pwaLifecycleActive: capturing.a }), tab('b', { pwaLifecycleActive: capturing.b })],
    closedTabs: [],
    activeTabId: 'a',
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47891/mcp',
    profilePath: '/tmp/hronaut-test',
    mcpTabGroups: [workspace()],
    savedTabGroups: []
  }
}

function renderTabs(state: BrowserState) {
  return render(BrowserTabsBar, {
    global: { plugins: [createHronautI18n('en-US')] },
    props: {
      state,
      hydrated: true,
      orientation: 'horizontal',
      railPinned: true,
      mcpActivityByTab: {},
      formatNumber: (value: number) => String(value),
      tabTooltip: (value: BrowserTabState) => value.title,
      describeEmulation: () => ''
    }
  })
}

function stopButton(container: Element, tabId: 'a' | 'b'): HTMLElement {
  const tabButton = container.querySelector(`[data-tab-id="${tabId}"]`)
  const stop = tabButton?.nextElementSibling
  if (!(stop instanceof HTMLElement) || !stop.classList.contains('tab-pwa-stop')) throw new Error(`No stop button for tab ${tabId}`)
  return stop
}

afterEach(() => { Reflect.deleteProperty(window, 'hronaut') })

describe('BrowserTabsBar worker capture stop', () => {
  it('shows a failed stop on the tab it failed for until that tab\'s capture ends or a later stop works', async () => {
    const pwaLifecycle = vi.fn(async ({ tabId }: { tabId: string }) => {
      if (tabId === 'a') throw new Error('Could not stop observing workers on A')
      return null
    })
    Object.defineProperty(window, 'hronaut', { configurable: true, value: { pwaLifecycle } })
    const view = renderTabs(browserState({ a: true, b: true }))

    await fireEvent.click(stopButton(view.container, 'a'))
    await flushPromises()
    expect(pwaLifecycle).toHaveBeenCalledWith({ tabId: 'a', action: 'stop' })
    expect(stopButton(view.container, 'a')).toHaveAttribute('data-tooltip', 'Could not stop observing workers on A')
    // Tab B's capture never failed, so its button still offers to stop it.
    expect(stopButton(view.container, 'b')).toHaveAttribute('data-tooltip', 'Stop observing workers')

    // A later stop that works takes the reason away.
    pwaLifecycle.mockResolvedValueOnce(null)
    await fireEvent.click(stopButton(view.container, 'a'))
    await flushPromises()
    expect(stopButton(view.container, 'a')).toHaveAttribute('data-tooltip', 'Stop observing workers')

    // So does the capture ending: a new capture on the tab starts without the old reason.
    await fireEvent.click(stopButton(view.container, 'a'))
    await flushPromises()
    expect(stopButton(view.container, 'a')).toHaveAttribute('data-tooltip', 'Could not stop observing workers on A')
    await view.rerender({ state: browserState({ a: false, b: true }) })
    await view.rerender({ state: browserState({ a: true, b: true }) })
    expect(stopButton(view.container, 'a')).toHaveAttribute('data-tooltip', 'Stop observing workers')
  })
})
