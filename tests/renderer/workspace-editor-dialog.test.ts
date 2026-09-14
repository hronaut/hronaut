import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceEditor from '../../src/renderer/src/components/WorkspaceEditor.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState } from '../../src/shared/types.js'

const originalBrowser = Object.getOwnPropertyDescriptor(window, 'hronaut')
afterEach(() => {
  if (originalBrowser) Object.defineProperty(window, 'hronaut', originalBrowser)
  else Reflect.deleteProperty(window, 'hronaut')
})

describe('workspace editor outside interaction', () => {
  it.each(['create', 'edit'] as const)('preserves the %s draft after backdrop clicks and text selection ending outside', async mode => {
    const state: BrowserState = {
      tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false,
      mcpUrl: '', profilePath: '', savedTabGroups: [],
      mcpTabGroups: [{ id: 'draft', name: 'Existing workspace', description: 'Keep the QA account and investigate checkout', color: 'purple', createdAt: '', lastUsedAt: '',
        tabCount: 0, activeTabId: null, storageOriginCount: 0,
        navigationPolicy: { mode: 'unrestricted', rules: [] } }]
    }
    Object.defineProperty(window, 'hronaut', { configurable: true, value: {
      getState: vi.fn(async () => state),
      listWorkspaceStorageOrigins: vi.fn(async () => []),
      listWorkspaceNavigationAudit: vi.fn(async () => [])
    } })
    const wrapper = mount(WorkspaceEditor, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('en-US')] },
      props: { open: false, state, canPresent: true, formatNumber: String, syncState: async () => undefined,
        'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
    })
    const editor = wrapper.vm as unknown as { openNew: () => Promise<void>; openExisting: (id: string) => Promise<void> }
    try {
      if (mode === 'create') await editor.openNew()
      else await editor.openExisting('draft')
      await nextTick()
      const input = wrapper.get<HTMLInputElement>('#tab-group-name')
      const description = wrapper.get<HTMLTextAreaElement>('#workspace-description')
      expect(description.element.value).toBe(mode === 'edit' ? 'Keep the QA account and investigate checkout' : '')
      await input.setValue('My unfinished launch checks')
      await description.setValue('Do not lose this investigation context')
      const overlay = wrapper.get('.tab-group-editor-overlay')
      await overlay.trigger('click')
      expect(wrapper.find('[role=dialog]').exists()).toBe(true)
      expect(input.element.value).toBe('My unfinished launch checks')
      expect(description.element.value).toBe('Do not lose this investigation context')
      await input.trigger('mousedown')
      await overlay.trigger('mouseup')
      await overlay.trigger('click')
      expect(wrapper.find('[role=dialog]').exists()).toBe(true)
      expect(input.element.value).toBe('My unfinished launch checks')
      await wrapper.get('.panel-close').trigger('click')
      expect(wrapper.find('[role=dialog]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })
})


describe('workspace data and agent access controls', () => {
  it('offers archived fork sources, starts blank, and saves the unchecked direct-access preference', async () => {
    const state: BrowserState = {
      tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '',
      mcpTabGroups: [{ id: 'personal', name: 'Personal', description: '', color: 'purple', createdAt: '', lastUsedAt: '',
        tabCount: 0, activeTabId: null, storageOriginCount: 1,
        navigationPolicy: { mode: 'unrestricted', rules: [] } }],
      savedTabGroups: [{ id: 'saved', name: 'Saved research', description: '', color: 'blue', savedAt: '', storageOriginCount: 1,
        tabs: [], navigationPolicy: { mode: 'unrestricted', rules: [] } }]
    }
    const createWorkspace = vi.fn(async () => state)
    Object.defineProperty(window, 'hronaut', { configurable: true, value: {
      getState: vi.fn(async () => state), createWorkspace,
      listWorkspaceStorageOrigins: vi.fn(async () => ['https://example.test']),
      listWorkspaceNavigationAudit: vi.fn(async () => [])
    } })
    const wrapper = mount(WorkspaceEditor, { global: { plugins: [createHronautI18n('en-US')] },
      props: { open: false, state, canPresent: true, formatNumber: String, syncState: async (next) => { await next },
        'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } } })
    try {
      await (wrapper.vm as unknown as { openNew: () => Promise<void> }).openNew()
      await flushPromises()
      await wrapper.get('input[value="fork-workspace"]').setValue(true)
      await wrapper.get('#workspace-fork-source').setValue('saved')
      await flushPromises()
      expect(wrapper.get('#workspace-fork-source').text()).toContain('Saved research · Archived')
      expect(wrapper.text()).toContain('The new workspace opens a blank tab. Existing tabs are not copied.')
      expect(wrapper.text()).toContain('Agents can still fork this workspace into an independent copy.')
      const access = wrapper.findAll('label').find(label => label.text().includes('Allow direct agent access'))!
      await access.get('input').setValue(false)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(createWorkspace).toHaveBeenCalledWith(expect.objectContaining({
        sourceWorkspaceId: 'saved', storage: 'fork-workspace', agentAccess: false
      }))
    } finally { wrapper.unmount() }
  })

  it('keeps legacy Default editable and explains why active-source Move is disabled', async () => {
    const state: BrowserState = {
      tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', savedTabGroups: [],
      mcpTabGroups: ['default', 'other'].map(id => ({ id, name: id === 'default' ? 'Default' : 'Other', description: '',
        color: 'purple', createdAt: '', lastUsedAt: '', tabCount: 0, activeTabId: null,
        isDefault: id === 'default', storageKind: id === 'default' ? 'default' : 'isolated', storageOriginCount: 1,
        navigationPolicy: { mode: 'unrestricted', rules: [] } }))
    }
    Object.defineProperty(window, 'hronaut', { configurable: true, value: {
      getState: vi.fn(async () => state), listWorkspaceStorageOrigins: vi.fn(async () => ['https://example.test']),
      listWorkspaceNavigationAudit: vi.fn(async () => [])
    } })
    const wrapper = mount(WorkspaceEditor, { global: { plugins: [createHronautI18n('en-US')] },
      props: { open: false, state, canPresent: true, formatNumber: String, syncState: async () => undefined,
        'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } } })
    try {
      await (wrapper.vm as unknown as { openExisting: (id: string) => Promise<void> }).openExisting('default')
      await flushPromises()
      expect(wrapper.get<HTMLInputElement>('#tab-group-name').element.disabled).toBe(false)
      expect(wrapper.find('.workspace-danger-zone').exists()).toBe(true)
      expect(wrapper.find('#workspace-transfer-source').exists()).toBe(true)
      await wrapper.get('input[value="move"]').setValue(true)
      expect(wrapper.get<HTMLButtonElement>('.workspace-transfer-button').element.disabled).toBe(true)
      expect(wrapper.text()).toContain('Archive both workspaces before moving data')
      expect(wrapper.text()).toContain('Matching destination cookies and storage keys are overwritten')
      await wrapper.get('input[value="copy"]').setValue(true)
      expect(wrapper.get<HTMLButtonElement>('.workspace-transfer-button').element.disabled).toBe(false)
    } finally { wrapper.unmount() }
  })
})

it('keeps Home templates open when an older workspace editor read finishes', async () => {
  const state = {
    tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false,
    mcpUrl: '', profilePath: '', savedTabGroups: [],
    mcpTabGroups: [{ id: 'old', name: 'Older request', description: '', color: 'purple', createdAt: '', lastUsedAt: '',
      tabCount: 0, activeTabId: null, storageOriginCount: 0, navigationPolicy: { mode: 'unrestricted', rules: [] } }]
  } as BrowserState
  let resolve!: (state: BrowserState) => void
  Object.defineProperty(window, 'hronaut', { configurable: true, value: {
    getState: vi.fn(() => new Promise<BrowserState>(finish => { resolve = finish })),
    listWorkspaceStorageOrigins: vi.fn(async () => []), listWorkspaceNavigationAudit: vi.fn(async () => [])
  } })
  const wrapper = mount(WorkspaceEditor, {
    global: { plugins: [createHronautI18n('en-US')], stubs: { WorkspaceTemplatePanel: { template: '<div>Template content</div>' } } },
    props: { open: false, state, canPresent: true, formatNumber: String, syncState: async () => undefined,
      'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
  })
  try {
    const editor = wrapper.vm as unknown as { openExisting: (id: string) => Promise<void>; openTemplates: () => void }
    const opening = editor.openExisting('old')
    editor.openTemplates()
    await flushPromises()
    resolve(state)
    await opening
    await flushPromises()
    expect(wrapper.get('#tab-group-editor-title').text()).toBe('Portable workspace templates')
    expect(wrapper.find('#tab-group-name').exists()).toBe(false)
    expect(wrapper.text()).toContain('Template content')
  } finally { wrapper.unmount() }
})
