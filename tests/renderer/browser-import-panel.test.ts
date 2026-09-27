import { mount, flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BrowserImportPanel from '../../src/renderer/src/components/BrowserImportPanel.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserState, HronautApi } from '../../src/shared/types.js'
const state = { tabs: [], mcpTabGroups: [], savedTabGroups: [{ id: 'chosen', name: 'Chosen workspace' }] } as unknown as BrowserState
function setup() {
  const browserImport = { list: vi.fn(async () => ({ ok: true, value: [{ id: 'source', browser: 'Chrome', name: 'Work' }] })), preview: vi.fn(async () => ({ ok: true, value: { id: 'preview', expiresAt: Date.now() + 10000, skipped: 3, sites: [{ domain: 'first.test', count: 2, includesSubdomains: true }, { domain: 'second.test', count: 1, includesSubdomains: false }] } })), cancel: vi.fn(async () => {}), commit: vi.fn(async () => ({ ok: true, value: { imported: 3, skipped: 0, failed: 0, recoveryRequired: false } })) }
  const browser = { browserImport, getState: vi.fn(async () => state), saveAndCloseTabGroup: vi.fn(async () => state), restoreSavedTabGroup: vi.fn(async () => state) } as unknown as HronautApi
  const wrapper = mount(BrowserImportPanel, { props: { workspaceId: 'chosen', state, browser, syncState: async value => { await value } }, global: { plugins: [createHronautI18n('en-US')] } })
  const button = (text: string) => wrapper.findAll('button').find(b => b.text() === text)!
  return { wrapper, browserImport, button, browser }
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
})
