import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceEditor from '../../src/renderer/src/components/WorkspaceEditor.vue'
import WorkspaceTemplatePanel from '../../src/renderer/src/components/WorkspaceTemplatePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { BROWSER_TAB_GROUP_COLORS } from '../../src/shared/tab-groups.js'
import type { BrowserState } from '../../src/shared/types.js'

// The workspace editor named its colors "Blue", "Purple" in every language, and the template editor listed the
// color codes ("blue", "purple") and the source platform's code ("macos").

const state: BrowserState = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [], savedTabGroups: [] }
const german = ['Grau', 'Blau', 'Türkis', 'Grün', 'Gelb', 'Orange', 'Rot', 'Rosa', 'Violett']

const originalBrowser = Object.getOwnPropertyDescriptor(window, 'hronaut')
const unmounts: (() => void)[] = []
afterEach(() => {
  unmounts.splice(0).forEach(unmount => unmount())
  if (originalBrowser) Object.defineProperty(window, 'hronaut', originalBrowser)
  else Reflect.deleteProperty(window, 'hronaut')
})

describe('workspace colors in the interface language', () => {
  it('names the workspace editor’s color choices in German', async () => {
    Object.defineProperty(window, 'hronaut', { configurable: true, value: {
      getState: vi.fn(async () => state),
      listWorkspaceStorageOrigins: vi.fn(async () => []),
      listWorkspaceNavigationAudit: vi.fn(async () => [])
    } })
    const wrapper = mount(WorkspaceEditor, {
      attachTo: document.body,
      global: { plugins: [createHronautI18n('de-DE')] },
      props: { open: false, state, canPresent: true, formatNumber: String, syncState: async () => undefined,
        'onUpdate:open': (open: boolean) => { void wrapper.setProps({ open }) } }
    })
    unmounts.push(() => wrapper.unmount())
    await (wrapper.vm as unknown as { openNew: () => Promise<void> }).openNew()
    await nextTick()
    expect(wrapper.findAll('[role=radio][data-color]').map(radio => radio.attributes('aria-label'))).toEqual(german)
  })

  it('lists the template editor’s colors in German and names the source platform', async () => {
    const template = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'macos', workspaces: [{ name: 'Demo', color: 'purple', startPages: [] }] })
    const browser = {
      openWorkspaceTemplateFile: vi.fn(async (): Promise<string | null> => template),
      saveWorkspaceTemplateFile: vi.fn(async () => true),
      importWorkspaceTemplate: vi.fn(async () => ({ status: 'completed' as const, workspaceIds: [], state })),
      closeWorkspace: vi.fn(async () => state)
    }
    const wrapper = mount(WorkspaceTemplatePanel, { props: { state, browser, syncState: vi.fn(async () => undefined) }, global: { plugins: [createHronautI18n('de-DE')] } })
    unmounts.push(() => wrapper.unmount())
    await wrapper.findAll('button').find(button => button.text() === 'Arbeitsbereichsvorlage öffnen')!.trigger('click')
    await flushPromises()
    const select = wrapper.get<HTMLSelectElement>('fieldset select')
    expect(select.findAll('option').map(option => option.text())).toEqual(german)
    expect(select.element.value).toBe('purple')
    expect(wrapper.text()).toContain('Quellplattform: macOS')
  })

  it('has a name for every workspace color in every language', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(localeMessages[locale].workspaceEditor.colors)).toEqual([...BROWSER_TAB_GROUP_COLORS])
    }
    expect(Object.values(localeMessages['en-US'].workspaceEditor.colors)).toEqual(['Gray', 'Blue', 'Cyan', 'Green', 'Yellow', 'Orange', 'Red', 'Pink', 'Purple'])
  })
})
