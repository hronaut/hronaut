import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BrowserImportPanel from '../../src/renderer/src/components/BrowserImportPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserImportApi, BrowserImportProfile } from '../../src/shared/browser-import.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
const state = { tabs: [], mcpTabGroups: [], savedTabGroups: [{ id: 'chosen', name: 'Chosen workspace' }] } as unknown as BrowserState
function setup(current = state, profiles: BrowserImportProfile[] = [{ id: 'source', browser: 'Chrome', name: 'Work' }]) {
  const browserImport = { list: vi.fn(async () => ({ ok: true, value: profiles })), preview: vi.fn(async () => ({ ok: true, value: { id: 'preview', expiresAt: Date.now() + 10000, skipped: 3, sites: [{ domain: 'first.test', count: 2, includesSubdomains: true }, { domain: 'second.test', count: 1, includesSubdomains: false }] } })), cancel: vi.fn(async () => {}), commit: vi.fn<BrowserImportApi['commit']>(async () => ({ ok: true, value: { imported: 3, skipped: 0, failed: 0, recoveryRequired: false } })) }
  const archive = vi.fn(async () => current)
  const browser = { browserImport, getState: vi.fn(async () => current), saveAndCloseTabGroup: archive, restoreSavedTabGroup: vi.fn(async () => current) } as unknown as HronautApi
  const wrapper = mount(BrowserImportPanel, { props: { workspaceId: 'chosen', state: current, browser, syncState: async value => { await value } }, global: { plugins: [createHronautI18n('en-US')] } })
  const button = (text: string) => wrapper.findAll('button').find(b => b.text() === text)!
  return { wrapper, browserImport, button, archive }
}
describe('browser import picker', () => {
  it('keeps the destination visible and does not read cookies until Continue', async () => {
    const { wrapper, browserImport, button } = setup()
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('Chosen workspace')
      expect(browserImport.preview).not.toHaveBeenCalled()
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenCalledWith('chosen', 'source')
      expect(wrapper.text()).toContain('0 of 2 sites selected')
      expect(browserImport.commit).not.toHaveBeenCalled()
    } finally { wrapper.unmount() }
  })
  it('shows display names while selecting a duplicate-named profile by its opaque ID', async () => {
    const { wrapper, browserImport, button } = setup(state, [
      { id: 'first-id', browser: 'Chrome', name: 'Avery · Default' },
      { id: 'second-id', browser: 'Chrome', name: 'Avery · Profile 10' }
    ])
    try {
      await flushPromises()
      expect(wrapper.findAll('option').map(option => option.text())).toEqual(['Chrome · Avery · Default', 'Chrome · Avery · Profile 10'])
      await wrapper.get('#browser-import-profile').setValue('second-id')
      expect(browserImport.preview).not.toHaveBeenCalled()
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenCalledExactlyOnceWith('chosen', 'second-id')
    } finally { wrapper.unmount() }
  })
  it('preserves hidden selections, uses matching bulk selection and commits only the chosen domains', async () => {
    const { wrapper, browserImport, button } = setup()
    try {
      await flushPromises(); await button('Continue').trigger('click'); await flushPromises()
      await wrapper.get('input[value="first.test"]').setValue(true)
      await wrapper.get('#browser-import-filter').setValue('second')
      await button('Select all matching sites').trigger('click')
      expect(wrapper.text()).toContain('2 of 2 sites selected')
      await button('Import into “Chosen workspace”').trigger('click'); await flushPromises()
      expect(browserImport.commit).toHaveBeenCalledWith('preview', ['first.test', 'second.test'])
      expect(wrapper.text()).toContain('Cookies imported: 3')
    } finally { wrapper.unmount() }
  })
  it('imports into an active workspace without archiving or closing its tabs', async () => {
    const active = { ...state, mcpTabGroups: state.savedTabGroups, savedTabGroups: [], tabs: [{ id: 'live-tab', mcpGroupId: 'chosen' }] } as unknown as BrowserState
    const { wrapper, browserImport, button, archive } = setup(active)
    try {
      await flushPromises(); await button('Continue').trigger('click'); await flushPromises()
      await button('Select all').trigger('click')
      expect(button('Import into “Chosen workspace”').attributes('disabled')).toBeUndefined()
      await button('Import into “Chosen workspace”').trigger('click'); await flushPromises()
      expect(browserImport.commit).toHaveBeenCalledWith('preview', ['first.test', 'second.test'])
      expect(archive).not.toHaveBeenCalled()
      expect(wrapper.text()).toContain('Open tabs stay open')
    } finally { wrapper.unmount() }
  })
  it('cancels without writing and discards a late preview', async () => {
    const { wrapper, browserImport, button } = setup()
    let finish!: (value: Awaited<ReturnType<typeof browserImport.preview>>) => void
    browserImport.preview.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await flushPromises(); await button('Continue').trigger('click'); await flushPromises()
    await button('Cancel').trigger('click')
    finish({ ok: true, value: { id: 'old', expiresAt: 1, skipped: 0, sites: [] } }); await flushPromises()
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(browserImport.cancel).toHaveBeenCalled(); expect(browserImport.commit).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Choose sites'); wrapper.unmount()
  })
  it.each(['response', 'transport'] as const)('requires a fresh preview after a commit %s failure', async failure => {
    const { wrapper, browserImport, button } = setup()
    try {
      await flushPromises(); await button('Continue').trigger('click'); await flushPromises()
      await button('Select all').trigger('click')
      if (failure === 'response') browserImport.commit.mockResolvedValueOnce({ ok: false, error: 'workspaceBusy' })
      else browserImport.commit.mockRejectedValueOnce(new Error('Connection lost'))
      await button('Import into “Chosen workspace”').trigger('click'); await flushPromises()
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
      expect(button('Import into “Chosen workspace”').attributes('disabled')).toBeDefined()
      await button('Import into “Chosen workspace”').trigger('click')
      expect(browserImport.commit).toHaveBeenCalledTimes(1)
      await button('Back').trigger('click'); await flushPromises()
      expect(browserImport.list).toHaveBeenCalledTimes(2)
      browserImport.preview.mockResolvedValueOnce({ ok: true, value: { id: 'fresh-preview', expiresAt: Date.now() + 10000, skipped: 0, sites: [{ domain: 'first.test', count: 1, includesSubdomains: false }] } })
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenCalledTimes(2)
      await button('Select all').trigger('click')
      expect(button('Import into “Chosen workspace”').attributes('disabled')).toBeUndefined()
      await button('Import into “Chosen workspace”').trigger('click'); await flushPromises()
      expect(browserImport.commit).toHaveBeenLastCalledWith('fresh-preview', ['first.test'])
      expect(wrapper.text()).toContain('Cookies imported: 3')
    } finally { wrapper.unmount() }
  })

})
