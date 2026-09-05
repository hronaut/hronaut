import { mount } from '@vue/test-utils'
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
      mcpTabGroups: [{ id: 'draft', name: 'Existing workspace', color: 'purple', createdAt: '', lastUsedAt: '',
        tabCount: 0, activeTabId: null, isDefault: false, storageKind: 'isolated', storageOriginCount: 0,
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
      await input.setValue('My unfinished launch checks')
      const overlay = wrapper.get('.tab-group-editor-overlay')
      await overlay.trigger('click')
      expect(wrapper.find('[role=dialog]').exists()).toBe(true)
      expect(input.element.value).toBe('My unfinished launch checks')
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
