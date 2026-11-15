import { mount } from '@vue/test-utils'
import { nextTick, shallowRef } from 'vue'
import { describe, expect, it } from 'vitest'
import BrowserTabsBar from '../../src/renderer/src/features/tabs/BrowserTabsBar.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

function workspace(id: string, overrides: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id,
    name: `Client ${id}`,
    description: '',
    color: 'purple',
    createdAt: '2026-08-22T09:00:00.000Z',
    lastUsedAt: '2026-08-22T09:00:00.000Z',
    tabCount: 1,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...overrides
  }
}

function tab(id: string, group: BrowserTabGroupState, active = false): BrowserTabState {
  return {
    id,
    title: `Page ${id}`,
    url: `https://example.test/${id}`,
    loading: false,
    navigationGeneration: 0,
    canGoBack: false,
    canGoForward: false,
    active,
    pinned: false,
    sleeping: false,
    humanInteractionLocked: false,
    preserveDiagnosticLogs: false,
    zoomPercent: 100,
    audible: false,
    muted: false,
    devToolsOpen: false,
    mcpGroupId: group.id,
    mcpGroupName: group.name
  }
}

describe('BrowserTabsBar workspaces the tab keys pass over', () => {
  it('passes over the workspaces the left rail does not list, hidden or folded into All N workspaces', async () => {
    const groups = Array.from({ length: 15 }, (_, index) => workspace(`w${index + 1}`))
    groups[1] = { ...groups[1], hiddenFromSidebar: true }
    const tabs = groups.map((group, index) => tab(`t${index + 1}`, group, index === 14))
    const state = shallowRef<BrowserState>({
      tabs,
      closedTabs: [],
      activeTabId: 't15',
      allHumanInteractionLocked: false,
      mcpUrl: 'http://127.0.0.1:47891/mcp',
      profilePath: '/tmp/hronaut-test',
      mcpTabGroups: groups,
      savedTabGroups: []
    })
    const wrapper = mount(BrowserTabsBar, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: {
        readState: () => state.value,
        readMcpActivity: () => ({}),
        hydrated: true,
        orientation: 'vertical',
        railPinned: true,
        formatNumber: (value: number) => String(value),
        tabTooltip: (value: BrowserTabState) => value.title,
        describeEmulation: () => ''
      }
    })
    const passedOver = () => [...(wrapper.vm as unknown as { passedOverWorkspaceIds: ReadonlySet<string> }).passedOverWorkspaceIds].sort()

    // The rail lists the first ten shown workspaces and the one in view; Ctrl+Tab and Ctrl+1 to 9 skip the rest.
    expect(passedOver()).toEqual(['w12', 'w13', 'w14', 'w2'])

    // The tab strip above the page lists every workspace, so the keys reach them all.
    await wrapper.setProps({ orientation: 'horizontal' })
    await nextTick()
    expect(passedOver()).toEqual([])
    wrapper.unmount()
  })
})
