import { describe, expect, it } from 'vitest'
import { computed, effectScope, shallowRef } from 'vue'
import { useTabStripModel } from '../../src/renderer/src/features/tabs/useTabStripModel.js'
import type { BrowserState, BrowserTabGroupState, BrowserTabState } from '../../src/shared/types.js'

function tab(id: string, fields: Partial<BrowserTabState> = {}): BrowserTabState {
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
    mcpGroupId: 'research',
    ...fields
  }
}

function workspace(fields: Partial<BrowserTabGroupState> = {}): BrowserTabGroupState {
  return {
    id: 'research',
    name: 'Research',
    description: '',
    color: 'purple',
    createdAt: '2026-11-05T09:00:00.000Z',
    lastUsedAt: '2026-11-05T09:00:00.000Z',
    tabCount: 2,
    activeTabId: null,
    storageOriginCount: 0,
    navigationPolicy: { mode: 'unrestricted', rules: [] },
    ...fields
  }
}

function state(fields: Partial<BrowserState> = {}): BrowserState {
  return {
    tabs: [tab('home', { url: 'hronaut://home', active: true, mcpGroupId: undefined }), tab('first'), tab('second', { loading: true })],
    closedTabs: [],
    activeTabId: 'home',
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:1/mcp',
    profilePath: '/profile',
    mcpTabGroups: [workspace()],
    savedTabGroups: [],
    splitView: { firstTabId: 'first', secondTabId: 'second', orientation: 'vertical', ratio: 0.5 },
    ...fields
  }
}

function setup(initial: BrowserState) {
  const current = shallowRef(initial)
  const scope = effectScope()
  const model = scope.run(() => useTabStripModel(() => current.value))!
  return { current, model, stop: () => scope.stop() }
}

describe('useTabStripModel', () => {
  it('keeps each part the same value while what the strip shows of it stays equal', () => {
    const { current, model, stop } = setup(state())
    const before = { tabs: model.tabs.value, home: model.home.value, workspaces: model.workspaces.value, split: model.splitView.value }
    expect(before.tabs.map((item) => [item.id, item.home])).toEqual([['home', true], ['first', false], ['second', false]])
    expect(before.home).toEqual({ active: true, loading: false })

    // A page getting its title, a workspace's counts and times, and the split view's divider are drawn by others.
    const previous = current.value
    current.value = state({
      tabs: [previous.tabs[0], tab('first', { title: 'Loaded', faviconDataUrl: 'data:,a' }), tab('second')],
      mcpTabGroups: [workspace({ tabCount: 3, lastUsedAt: '2026-11-05T10:00:00.000Z', activeTabId: 'second' })],
      splitView: { firstTabId: 'first', secondTabId: 'second', orientation: 'vertical', ratio: 0.7 }
    })
    expect(model.tabs.value).toBe(before.tabs)
    expect(model.home.value).toBe(before.home)
    expect(model.workspaces.value).toBe(before.workspaces)
    expect(model.splitView.value).toBe(before.split)
    // Each row still reads its tab as it is now.
    expect(model.readTab('first')?.title).toBe('Loaded')
    stop()
  })

  it('lets a row that read its tab skip looking again while the list of tabs is the same', () => {
    const { current, model, stop } = setup(state())
    let looks = 0
    const first = computed(() => { looks += 1; return model.readTab('first') })
    expect(first.value?.id).toBe('first')
    // The shell's store keeps its list of tabs when none of them changed.
    current.value = { ...current.value, activeTabId: 'first' }
    expect(first.value?.id).toBe('first')
    expect(looks).toBe(1)
    current.value = { ...current.value, tabs: [...current.value.tabs] }
    expect(first.value?.id).toBe('first')
    expect(looks).toBe(2)
    stop()
  })

  it('makes a new value when what the strip shows changes', () => {
    const { current, model, stop } = setup(state())
    const before = { tabs: model.tabs.value, home: model.home.value, workspaces: model.workspaces.value, split: model.splitView.value }
    current.value = state({
      tabs: [tab('home', { url: 'hronaut://home', active: true, loading: true, mcpGroupId: undefined }), tab('first', { pinned: true }), tab('second')],
      mcpTabGroups: [workspace({ name: 'Shop' })],
      splitView: { firstTabId: 'first', secondTabId: 'second', orientation: 'horizontal', ratio: 0.5 }
    })
    expect(model.tabs.value).not.toBe(before.tabs)
    expect(model.tabs.value[1]).toEqual({ id: 'first', mcpGroupId: 'research', active: false, pinned: true, home: false })
    expect(model.home.value).toEqual({ active: true, loading: true })
    expect(model.workspaces.value.map((group) => group.name)).toEqual(['Shop'])
    expect(model.splitView.value).toEqual({ firstTabId: 'first', secondTabId: 'second', orientation: 'horizontal' })

    current.value = state({ tabs: [tab('first')], mcpTabGroups: [], splitView: undefined })
    expect(model.home.value).toBeUndefined()
    expect(model.workspaces.value).toEqual([])
    expect(model.splitView.value).toBeUndefined()
    expect(model.readTab('second')).toBeUndefined()
    stop()
  })
})
