import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTemplatePanel from '../../src/renderer/src/components/WorkspaceTemplatePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import type { BrowserState, SupportedLocale } from '../../src/shared/types.js'
import { WORKSPACE_TEMPLATE_ERRORS, nextWorkspaceTemplateName } from '../../src/shared/workspace-template.js'

// The template editor refused a file or a start page in English in every language, showed main's refusals with
// "TypeError:" in front, and named new entries "Workspace 1".

const state: BrowserState = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [], savedTabGroups: [] }
const valid = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Demo', color: 'blue', startPages: [] }] })
const german = localeMessages['de-DE'].workspaceTemplates
const unmounts: (() => void)[] = []
afterEach(() => { unmounts.splice(0).forEach(unmount => unmount()) })

function setup(locale: SupportedLocale, file: string, importTemplate: () => Promise<never> = vi.fn()) {
  const browser = {
    openWorkspaceTemplateFile: vi.fn(async (): Promise<string | null> => file),
    saveWorkspaceTemplateFile: vi.fn(async () => true),
    importWorkspaceTemplate: vi.fn(importTemplate),
    closeWorkspace: vi.fn(async () => state)
  }
  const wrapper = mount(WorkspaceTemplatePanel, { props: { state, browser, syncState: vi.fn(async () => undefined) }, global: { plugins: [createHronautI18n(locale)] } })
  unmounts.push(() => wrapper.unmount())
  const click = async (text: string) => { await wrapper.findAll('button').find(button => button.text() === text)!.trigger('click'); await flushPromises() }
  const alerts = () => wrapper.findAll('[role=alert]').map(alert => alert.text())
  return { wrapper, click, alerts }
}

describe('workspace template editor in the interface language', () => {
  it('refuses a file that is not JSON in German', async () => {
    const { click, alerts } = setup('de-DE', '{')
    await click(german.openFile)
    expect(alerts()).toEqual(['Die Arbeitsbereichsvorlage ist kein gültiges JSON.'])
  })

  it('refuses a start page with credentials or another scheme in German while editing', async () => {
    const { wrapper, click, alerts } = setup('de-DE', valid)
    await click(german.newExport)
    await wrapper.get('fieldset textarea[spellcheck=false]').setValue('ftp://example.test/')
    await wrapper.get('fieldset textarea[spellcheck=false]').trigger('change')
    expect(alerts()).toEqual(['Startseiten in Vorlagen müssen HTTP(S) verwenden und dürfen keine Zugangsdaten in der URL enthalten.'])
  })

  it('names main’s refusal without its TypeError prefix and keeps an unknown error as it came', async () => {
    const refused = setup('de-DE', valid, async () => { throw new Error("Error invoking remote method 'browser:import-workspace-template': TypeError: Invalid workspace template.") })
    await refused.click(german.openFile)
    await refused.wrapper.get('.template-review input').setValue(true)
    await refused.click(german.import)
    expect(refused.alerts()).toEqual(['Ungültige Arbeitsbereichsvorlage.'])

    const unknown = setup('de-DE', valid, async () => { throw new Error('Disk full') })
    await unknown.click(german.openFile)
    await unknown.wrapper.get('.template-review input').setValue(true)
    await unknown.click(german.import)
    expect(unknown.alerts()).toEqual(['Disk full'])
  })

  it('names new entries in the interface language', async () => {
    const { wrapper, click } = setup('de-DE', valid)
    await click(german.newExport)
    await click(german.add)
    expect(wrapper.findAll<HTMLInputElement>('fieldset input[maxlength="80"]').map(input => input.element.value)).toEqual(['Arbeitsbereich 1', 'Arbeitsbereich 2'])
    expect(nextWorkspaceTemplateName([{ name: 'arbeitsbereich 2' }], number => `Arbeitsbereich ${number}`)).toBe('Arbeitsbereich 3')
    expect(nextWorkspaceTemplateName([{ name: 'Workspace 2' }])).toBe('Workspace 3')
  })

  it('has a message for every refusal in every language and keeps the English the checks throw', () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(Object.keys(localeMessages[locale].workspaceTemplates.errors)).toEqual(Object.keys(WORKSPACE_TEMPLATE_ERRORS))
    }
    expect(localeMessages['en-US'].workspaceTemplates.errors).toEqual(WORKSPACE_TEMPLATE_ERRORS)
  })
})
