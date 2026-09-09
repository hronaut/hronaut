import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTemplatePanel from '../../src/renderer/src/components/WorkspaceTemplatePanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState } from '../../src/shared/types.js'

const state: BrowserState = { tabs: [], closedTabs: [], activeTabId: null, allHumanInteractionLocked: false, mcpUrl: '', profilePath: '', mcpTabGroups: [], savedTabGroups: [] }
const manifest = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Demo', color: 'blue', startPages: [] }] })
const wrappers: (() => void)[] = []
afterEach(() => { wrappers.splice(0).forEach(unmount => unmount()) })
function setup() {
  const browser = {
    openWorkspaceTemplateFile: vi.fn(async (): Promise<string | null> => manifest),
    saveWorkspaceTemplateFile: vi.fn(async (_text: string) => true),
    importWorkspaceTemplate: vi.fn(async (_text: string) => ({ status: 'completed' as 'completed' | 'partial' | 'rolled-back', workspaceIds: ['new'], state })),
    closeWorkspace: vi.fn(async (_id: string) => state)
  }
  const syncState = vi.fn(async () => undefined)
  const wrapper = mount(WorkspaceTemplatePanel, { props: { state, browser, syncState }, global: { plugins: [createHronautI18n('en-US')] } })
  wrappers.push(() => wrapper.unmount())
  const button = (text: string) => wrapper.findAll('button').find(button => button.text() === text)!
  return { wrapper, browser, syncState, button }
}

describe('workspace template review', () => {
  it('requires review and invalidates it after changing a name', async () => {
    const { wrapper, browser, button } = setup()
    await button('Open workspace template').trigger('click'); await flushPromises()
    expect(browser.importWorkspaceTemplate).not.toHaveBeenCalled()
    expect(button('Import and open pages').attributes('disabled')).toBeDefined()
    await wrapper.get('.template-review input').setValue(true)
    expect(button('Import and open pages').attributes('disabled')).toBeUndefined()
    await wrapper.get('fieldset input').setValue('Changed')
    expect(button('Import and open pages').attributes('disabled')).toBeDefined()
    await wrapper.get('.template-review input').setValue(true)
    await button('Import and open pages').trigger('click'); await flushPromises()
    expect(JSON.parse(browser.importWorkspaceTemplate.mock.calls.at(0)?.[0] ?? '{}' )).toMatchObject({ workspaces: [{ name: 'Changed' }] })
  })
  it('starts exports with generic metadata and makes no write before review', async () => {
    const { wrapper, browser, button } = setup()
    await button('Prepare export').trigger('click')
    expect(wrapper.get<HTMLInputElement>('fieldset input').element.value).toBe('Workspace 1')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
    expect(browser.saveWorkspaceTemplateFile).not.toHaveBeenCalled()
    await wrapper.get('.template-review input').setValue(true)
    await button('Save workspace template').trigger('click'); await flushPromises()
    expect(browser.saveWorkspaceTemplateFile).toHaveBeenCalledTimes(1)
  })
  it('preserves a successful import when state refresh fails and prevents replay', async () => {
    const { wrapper, syncState, browser, button } = setup()
    syncState.mockRejectedValueOnce(new Error('refresh failed'))
    await button('Open workspace template').trigger('click'); await flushPromises()
    await wrapper.get('.template-review input').setValue(true)
    await button('Import and open pages').trigger('click'); await flushPromises()
    expect(wrapper.text()).toContain('The new workspaces were imported.')
    expect(button('Import and open pages').attributes('disabled')).toBeDefined()
    expect(browser.importWorkspaceTemplate).toHaveBeenCalledTimes(1)
  })
  it('retries only retained profiles and does not repeat deletion after refresh fails', async () => {
    const { wrapper, syncState, browser, button } = setup()
    browser.importWorkspaceTemplate.mockResolvedValueOnce({ status: 'partial', workspaceIds: ['retained-new'], state })
    await button('Open workspace template').trigger('click'); await flushPromises()
    await wrapper.get('.template-review input').setValue(true)
    await button('Import and open pages').trigger('click'); await flushPromises()
    syncState.mockRejectedValueOnce(new Error('refresh failed'))
    await button('Retry cleanup').trigger('click'); await flushPromises()
    expect(browser.closeWorkspace).toHaveBeenCalledWith('retained-new')
    expect(wrapper.text()).toContain('remaining imported profiles were removed')
    expect(button('Retry cleanup')).toBeUndefined()
  })
})
