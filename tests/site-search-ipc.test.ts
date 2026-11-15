import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { LocalizedError } from '../src/main/localized-error.js'
import { SITE_SEARCH_LIMIT, type SiteSearch } from '../src/shared/site-search.js'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {} }))

const { registerSiteSearchIpc } = await import('../src/main/site-search-ipc.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings/settings-store.js')

// Settings had no Site search list to keep, so main had nothing to check or save. Main now adds, edits and deletes the
// shortcuts, checks each one with the rules the form shows, and makes quick changes one after another.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const WIKIPEDIA = { name: 'Wikipedia', keyword: 'W', url: 'https://en.wikipedia.org/w/index.php?search=%s' }

function siteSearchIpc(siteSearches: SiteSearch[] = []) {
  const handlers = new Map<string, Handler>()
  const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
  let settings: AppSettings = { ...DEFAULT_SETTINGS, siteSearches }
  // Each save takes a turn of the event loop, as the settings file's write does.
  const host = {
    assertTrustedSender: vi.fn(),
    settings: () => settings,
    updateSettings: vi.fn(async (patch: Partial<AppSettings>) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      settings = { ...settings, ...patch }
      return settings
    }),
    publishSettings: vi.fn()
  }
  registerSiteSearchIpc(ipcMain, host)
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!({} as IpcMainInvokeEvent, ...args))
  return { invoke, host, list: () => settings.siteSearches }
}

describe('site search IPC', () => {
  it('adds a checked site search with an id of its own, and publishes the settings', async () => {
    const { invoke, host, list } = siteSearchIpc()
    const result = await invoke('settings:add-site-search', { ...WIKIPEDIA, name: ' Wikipedia ' }) as AppSettings
    expect(host.assertTrustedSender).toHaveBeenCalledOnce()
    expect(list()).toEqual([{ id: expect.stringMatching(/^[0-9a-f-]{36}$/u), name: 'Wikipedia', keyword: 'w', url: WIKIPEDIA.url }])
    expect(result.siteSearches).toEqual(list())
    expect(host.publishSettings).toHaveBeenCalledOnce()
  })

  it('edits and deletes a site search by its id', async () => {
    const saved: SiteSearch = { id: 'wiki', name: 'Wikipedia', keyword: 'w', url: WIKIPEDIA.url }
    const docs: SiteSearch = { id: 'docs', name: 'Docs', keyword: 'd', url: 'https://docs.example/?q=%s' }
    const { invoke, list } = siteSearchIpc([saved, docs])
    await invoke('settings:update-site-search', 'wiki', { name: 'Wiki', keyword: 'w', url: 'https://de.wikipedia.org/?search=%s' })
    expect(list()).toEqual([{ id: 'wiki', name: 'Wiki', keyword: 'w', url: 'https://de.wikipedia.org/?search=%s' }, docs])
    await invoke('settings:remove-site-search', 'wiki')
    expect(list()).toEqual([docs])
    // One deleted in another window first is gone already.
    await invoke('settings:remove-site-search', 'wiki')
    expect(list()).toEqual([docs])
  })

  it('keeps both of two quick changes', async () => {
    const { invoke, host, list } = siteSearchIpc()
    await Promise.all([
      invoke('settings:add-site-search', WIKIPEDIA),
      invoke('settings:add-site-search', { name: 'Docs', keyword: 'd', url: 'https://docs.example/?q=%s' })
    ])
    expect(list().map((entry) => entry.keyword)).toEqual(['w', 'd'])
    // The second saw the first, so a repeated shortcut is refused even when both arrive at once.
    const repeated = await Promise.allSettled([
      invoke('settings:add-site-search', { ...WIKIPEDIA, keyword: 'x' }),
      invoke('settings:add-site-search', { ...WIKIPEDIA, keyword: 'x' })
    ])
    expect(repeated.map((outcome) => outcome.status)).toEqual(['fulfilled', 'rejected'])
    expect(list().map((entry) => entry.keyword)).toEqual(['w', 'd', 'x'])
    expect(host.updateSettings).toHaveBeenCalledTimes(3)
  })

  it('refuses a site search the form would not save, and a change to one that is gone', async () => {
    const { invoke, host, list } = siteSearchIpc([{ id: 'wiki', name: 'Wikipedia', keyword: 'w', url: WIKIPEDIA.url }])
    for (const draft of [
      { ...WIKIPEDIA, keyword: 'w' },
      { ...WIKIPEDIA, keyword: 'bing.com' },
      { ...WIKIPEDIA, keyword: 'n', url: 'javascript:alert(%s)' },
      { ...WIKIPEDIA, keyword: 'n', url: 'https://example.org/' },
      { ...WIKIPEDIA, keyword: 'n', name: '' }
    ]) {
      await expect(invoke('settings:add-site-search', draft), draft.keyword + draft.url).rejects.toMatchObject({ key: 'appErrors.settings.siteSearchRejected' })
    }
    for (const draft of [null, 'w', { name: 'A', keyword: 'a' }, { name: 1, keyword: 'a', url: 'https://a.example/?q=%s' }]) {
      await expect(invoke('settings:add-site-search', draft)).rejects.toThrow(TypeError)
    }
    await expect(invoke('settings:update-site-search', 'gone', WIKIPEDIA)).rejects.toBeInstanceOf(LocalizedError)
    await expect(invoke('settings:update-site-search', 'gone', WIKIPEDIA)).rejects.toMatchObject({ key: 'appErrors.settings.siteSearchMissing' })
    await expect(invoke('settings:update-site-search', 'bad id', WIKIPEDIA)).rejects.toThrow(TypeError)
    await expect(invoke('settings:remove-site-search', { id: 'wiki' })).rejects.toThrow(TypeError)
    expect(list()).toHaveLength(1)
    expect(host.updateSettings).not.toHaveBeenCalled()
    // A failed change leaves the next one free to save.
    await invoke('settings:add-site-search', { ...WIKIPEDIA, keyword: 'n' })
    expect(list().map((entry) => entry.keyword)).toEqual(['w', 'n'])
  })

  it('refuses a site search past the limit', async () => {
    const full = Array.from({ length: SITE_SEARCH_LIMIT }, (_, index) => ({
      id: `site-${index}`, name: `Site ${index}`, keyword: `s${index}`, url: `https://s${index}.example/?q=%s`
    }))
    const { invoke, list } = siteSearchIpc(full)
    await expect(invoke('settings:add-site-search', WIKIPEDIA)).rejects.toMatchObject({
      key: 'appErrors.settings.siteSearchListFull',
      message: 'The site search list is full. Delete a site search to add another.'
    })
    expect(list()).toHaveLength(SITE_SEARCH_LIMIT)
  })

  it('answers only Hronaut\'s own windows', async () => {
    const { invoke, host, list } = siteSearchIpc()
    host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted sender') })
    for (const [channel, ...args] of [
      ['settings:add-site-search', WIKIPEDIA],
      ['settings:update-site-search', 'wiki', WIKIPEDIA],
      ['settings:remove-site-search', 'wiki']
    ] as const) {
      await expect(invoke(channel, ...args)).rejects.toThrow('Untrusted sender')
    }
    expect(list()).toEqual([])
  })
})
