import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import WorkspaceLibrary from '../../src/renderer/src/components/WorkspaceLibrary.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState } from '../../src/shared/types.js'

function setup() {
  const group = { id: 'alpha', name: 'Alpha project', color: 'blue' as const, createdAt: '', lastUsedAt: '2026-09-12', tabCount: 0, activeTabId: null, storageOriginCount: 2, agentAccess: false, navigationPolicy: { mode: 'unrestricted' as const, rules: [] } }
  const saved = { id: 'saved', name: 'Saved research', color: 'purple' as const, savedAt: '2026-09-11', storageOriginCount: 1, tabs: [{ url: 'https://example.test', title: 'Research notes', pinned: false }], navigationPolicy: group.navigationPolicy }
  const state: BrowserState = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [group], savedTabGroups: [saved] }
  const browser = { selectTab: vi.fn(async () => state), newTab: vi.fn(async () => state), saveAndCloseTabGroup: vi.fn(async () => ({ ...state, mcpTabGroups: [], savedTabGroups: [...state.savedTabGroups, { ...group, savedAt: '', tabs: [] }] })), restoreSavedTabGroup: vi.fn(async () => state), deleteSavedTabGroup: vi.fn(async () => state) }
  const wrapper = mount(WorkspaceLibrary, { props: { state, browser, syncState: async (next: Promise<BrowserState> | BrowserState) => { await wrapper.setProps({ state: await next }) } }, global: { plugins: [createHronautI18n('en-US')] } })
  const button = (text: string) => wrapper.findAll('button').find(button => button.text() === text)!
  return { wrapper, browser, state, button }
}

describe('workspace library', () => {
  it('searches the chosen collection by workspace name and saved page title', async () => {
    const { wrapper, button } = setup()
    try {
      expect(wrapper.findAll('article')).toHaveLength(1)
      expect(wrapper.text()).toContain('Direct agent access off')
      await wrapper.get('input[type=search]').setValue('Research notes')
      expect(wrapper.text()).toContain('No matching workspaces')
      await button('Archived (1)').trigger('click')
      expect(wrapper.get('article').attributes('aria-label')).toBe('Saved research')
      await wrapper.get('input[type=search]').setValue('nothing matches')
      await button('Clear search').trigger('click')
      expect(wrapper.findAll('article')).toHaveLength(1)
    } finally { wrapper.unmount() }
  })

  it('opens a tabless workspace in its own profile and closes only after completion', async () => {
    const { wrapper, browser, button } = setup()
    try {
      await button('Open workspace').trigger('click')
      await flushPromises()
      expect(browser.newTab).toHaveBeenCalledWith({ mcpGroupId: 'alpha', active: true })
      expect(wrapper.emitted('close')).toHaveLength(1)
      expect(wrapper.emitted('busy')).toEqual([[true], [false]])
    } finally { wrapper.unmount() }
  })

  it('archives without deleting data and can undo that exact archive', async () => {
    const { wrapper, browser, button } = setup()
    try {
      await button('Archive').trigger('click')
      await flushPromises()
      expect(browser.saveAndCloseTabGroup).toHaveBeenCalledWith('alpha')
      expect(browser.deleteSavedTabGroup).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Tabs and sign-ins are saved')
      await button('Undo archive').trigger('click')
      await flushPromises()
      expect(browser.restoreSavedTabGroup).toHaveBeenCalledWith('alpha')
      expect(wrapper.emitted('close')).toBeUndefined()
    } finally { wrapper.unmount() }
  })

  it('serializes pending actions and keeps a failed workspace available for retry', async () => {
    const { wrapper, browser, button } = setup()
    let reject!: (error: Error) => void
    browser.newTab.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail }))
    try {
      await button('Open workspace').trigger('click')
      expect(button('Archive').attributes('disabled')).toBeDefined()
      expect(button('Manage').attributes('disabled')).toBeDefined()
      reject(new Error('Workspace is unavailable'))
      await flushPromises()
      expect(wrapper.get('[role=alert]').text()).toBe('Workspace is unavailable')
      expect(wrapper.emitted('close')).toBeUndefined()
      expect(button('Open workspace').attributes('disabled')).toBeUndefined()
    } finally { wrapper.unmount() }
  })

  it('requires confirmation to delete an archive and respects the interaction lock', async () => {
    const { wrapper, browser, state, button } = setup()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    try {
      await wrapper.setProps({ state: { ...state, allHumanInteractionLocked: true } })
      expect(button('Archive').attributes('disabled')).toBeDefined()
      await button('Archived (1)').trigger('click')
      expect(button('Delete…').attributes('disabled')).toBeDefined()
      await wrapper.setProps({ state })
      await button('Delete…').trigger('click')
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Saved research'))
      expect(browser.deleteSavedTabGroup).not.toHaveBeenCalled()
      confirm.mockReturnValue(true)
      await button('Delete…').trigger('click')
      await flushPromises()
      expect(browser.deleteSavedTabGroup).toHaveBeenCalledWith('saved')
    } finally { wrapper.unmount(); confirm.mockRestore() }
  })

  it('does not dismiss a newer surface after an old operation completes', async () => {
    const { wrapper, browser, state, button } = setup()
    let resolve!: (state: BrowserState) => void
    browser.newTab.mockImplementation(() => new Promise(done => { resolve = done }))
    await button('Open workspace').trigger('click')
    wrapper.unmount()
    resolve(state)
    await flushPromises()
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
