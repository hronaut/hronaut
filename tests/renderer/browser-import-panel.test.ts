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
  it('shows a failure from the main process without Electron\'s IPC wrapper', async () => {
    const list = vi.fn(async () => { throw new Error("Error invoking remote method 'browser-import:list': Error: Збережені робочі простори недоступні.") })
    const browser = { browserImport: { list, preview: vi.fn(), cancel: vi.fn(async () => {}), commit: vi.fn() }, getState: vi.fn(async () => state) } as unknown as HronautApi
    const wrapper = mount(BrowserImportPanel, { props: { workspaceId: 'chosen', state, browser, syncState: async value => { await value } }, global: { plugins: [createHronautI18n('en-US')] } })
    try {
      await flushPromises()
      expect(wrapper.text()).toContain('Збережені робочі простори недоступні.')
      expect(wrapper.text()).not.toContain('Error invoking remote method')
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
  it('keeps the chosen profile after Back, which lists the profiles again under new IDs', async () => {
    const { wrapper, browserImport, button } = setup(state, [
      { id: 'default-id', browser: 'Chrome', name: 'Default' },
      { id: 'work-id', browser: 'Chrome', name: 'Work' }
    ])
    try {
      await flushPromises()
      await wrapper.get('#browser-import-profile').setValue('work-id')
      await button('Continue').trigger('click'); await flushPromises()
      browserImport.list.mockResolvedValueOnce({ ok: true, value: [
        { id: 'new-default-id', browser: 'Chrome', name: 'Default' },
        { id: 'new-work-id', browser: 'Chrome', name: 'Work' }
      ] })
      await button('Back').trigger('click'); await flushPromises()
      // Back chose the first profile, so the next Continue read Default.
      expect((wrapper.get('#browser-import-profile').element as HTMLSelectElement).value).toBe('new-work-id')
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenLastCalledWith('chosen', 'new-work-id')

      // A name two profiles now share can't say which one was chosen, so the first is chosen, as at the start.
      browserImport.list.mockResolvedValueOnce({ ok: true, value: [
        { id: 'one-id', browser: 'Chrome', name: 'Default' },
        { id: 'two-id', browser: 'Chrome', name: 'Work' },
        { id: 'three-id', browser: 'Chrome', name: 'Work' }
      ] })
      await button('Back').trigger('click'); await flushPromises()
      expect((wrapper.get('#browser-import-profile').element as HTMLSelectElement).value).toBe('one-id')
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
  // Main forgets the listed profiles five minutes after listing them, and the picker never listed them again, so after a
  // longer wait, such as closing the source browser as an error asks, every Continue said the preview expired.
  it('lists the profiles again and reads the same one when they expired while the picker was open', async () => {
    const { wrapper, browserImport, button } = setup(state, [
      { id: 'old-home', browser: 'Chrome', name: 'Home' },
      { id: 'old-work', browser: 'Chrome', name: 'Work' }
    ])
    try {
      await flushPromises()
      await wrapper.get('#browser-import-profile').setValue('old-work')
      browserImport.preview.mockResolvedValueOnce({ ok: false, error: 'expired' } as never)
      browserImport.list.mockResolvedValueOnce({ ok: true, value: [
        { id: 'new-home', browser: 'Chrome', name: 'Home' },
        { id: 'new-work', browser: 'Chrome', name: 'Work' }
      ] })
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenNthCalledWith(1, 'chosen', 'old-work')
      expect(browserImport.preview).toHaveBeenNthCalledWith(2, 'chosen', 'new-work')
      expect(wrapper.text()).toContain('Choose sites')
      expect(wrapper.text()).toContain('Chrome · Work')
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally { wrapper.unmount() }
  })
  it('asks to choose again when the expired profile is no longer listed', async () => {
    const { wrapper, browserImport, button } = setup()
    try {
      await flushPromises()
      browserImport.preview.mockResolvedValueOnce({ ok: false, error: 'expired' } as never)
      browserImport.list.mockResolvedValueOnce({ ok: true, value: [{ id: 'other', browser: 'Firefox', name: 'Default' }] })
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[role="alert"]').text()).toBe('This preview expired or its workspace changed. Choose the profile again.')
      expect(wrapper.findAll('option').map(option => option.text())).toEqual(['Firefox · Default'])
      // Nothing is chosen for the person, so a quick second Continue cannot read another profile.
      expect(button('Continue').attributes('disabled')).toBeDefined()
      await wrapper.get('#browser-import-profile').setValue('other')
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenLastCalledWith('chosen', 'other')
      expect(wrapper.text()).toContain('Choose sites')
    } finally { wrapper.unmount() }
  })


  it('asks to choose again when profiles in different folders read the same', async () => {
    const twin = { browser: 'Firefox', name: 'Work · abcd.default' }
    const { wrapper, browserImport, button } = setup(state, [{ id: 'old-first', ...twin }, { id: 'old-second', ...twin }])
    try {
      await flushPromises()
      await wrapper.get('#browser-import-profile').setValue('old-second')
      browserImport.preview.mockResolvedValueOnce({ ok: false, error: 'expired' } as never)
      browserImport.list.mockResolvedValueOnce({ ok: true, value: [{ id: 'new-first', ...twin }, { id: 'new-second', ...twin }] })
      await button('Continue').trigger('click'); await flushPromises()
      expect(browserImport.preview).toHaveBeenCalledTimes(1)
      expect(wrapper.find('[role="alert"]').text()).toBe('This preview expired or its workspace changed. Choose the profile again.')
    } finally { wrapper.unmount() }
  })
  it.each(['Cancel', 'closing the panel'] as const)('does not list the profiles again for a preview that expired after %s', async (ending) => {
    const { wrapper, browserImport, button } = setup()
    let finish!: (value: Awaited<ReturnType<typeof browserImport.preview>>) => void
    browserImport.preview.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    await flushPromises(); await button('Continue').trigger('click'); await flushPromises()
    if (ending === 'Cancel') await button('Cancel').trigger('click')
    else wrapper.unmount()
    finish({ ok: false, error: 'expired' } as never); await flushPromises()
    expect(browserImport.list).toHaveBeenCalledTimes(1)
    if (ending === 'Cancel') wrapper.unmount()
  })
})
