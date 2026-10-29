import type { IpcMain, IpcMainInvokeEvent, Session } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import type { AppSettings } from '../src/shared/types.js'

vi.mock('electron', () => ({ app: { getPath: () => '' }, nativeTheme: {}, session: { fromPartition: vi.fn() } }))

const { automaticSpellCheckLanguages, createSpellCheck, registerSpellCheckIpc } = await import('../src/main/settings/spell-check.js')
const { createBrowserSession } = await import('../src/main/browser-session.js')
const { DEFAULT_SETTINGS } = await import('../src/main/settings/settings-store.js')
const { commitRuntimeSetting } = await import('../src/main/settings/runtime-setting-commit.js')

// Websites' text fields always checked spelling: Hronaut had no way to turn it off, as Chrome's Spell check switch
// does. Every browser session now follows one setting, from Settings or a text field's menu.

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

// Part of Chromium's dictionary list on Linux and Windows.
const DICTIONARIES = ['de', 'de-DE', 'en-GB', 'en-US', 'es', 'es-419', 'fr', 'pt-BR', 'pt-PT', 'uk']

function spellCheckRuntime(saved: Partial<AppSettings> = {}, platform: { available?: string[], locale?: string } = {}) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, ...saved }
  let saveFails = false
  let saving: (() => void) | undefined
  const order: string[] = []
  const host = {
    settings: () => settings,
    // As settings-runtime does: the runtime change first, then the save, with the previous setting put back on failure.
    updateSettings: vi.fn(async (updates: Partial<AppSettings>, applyRuntime?: (value: AppSettings) => void | Promise<void>) => {
      const next = { ...settings, ...updates }
      await commitRuntimeSetting({
        previous: settings,
        next,
        apply: applyRuntime ?? (() => undefined),
        persist: async () => {
          saving?.()
          if (saveFails) throw new Error('disk full')
        }
      })
      settings = next
      return settings
    }),
    publishSettings: vi.fn(() => { order.push('published') }),
    availableLanguages: () => platform.available ?? DICTIONARIES,
    locale: () => platform.locale ?? 'en-US'
  }
  const spellCheck = createSpellCheck(host)
  // A session starts with the languages it was given last, which Chromium keeps in the profile across restarts.
  const session = (startLanguages: string[] = ['en-US']) => {
    const calls: boolean[] = []
    const languageCalls: string[][] = []
    let languages = [...startLanguages]
    return {
      calls,
      languageCalls,
      languages: () => languages,
      setSpellCheckerEnabled: (enabled: boolean) => { calls.push(enabled); order.push(`session ${enabled}`) },
      getSpellCheckerLanguages: () => [...languages],
      setSpellCheckerLanguages: (next: string[]) => {
        languageCalls.push([...next])
        languages = [...next]
        order.push(`session languages ${next.join(',')}`)
      }
    }
  }
  return {
    spellCheck, host, session, order,
    settings: () => settings,
    failSaves: () => { saveFails = true },
    whileSaving: (action: () => void) => { saving = action }
  }
}

describe('spell check', () => {
  it('has each session check spelling as the setting says when it is tracked, once', () => {
    const on = spellCheckRuntime()
    const first = on.session()
    on.spellCheck.track(first)
    on.spellCheck.track(first)
    expect(first.calls).toEqual([true])

    const off = spellCheckRuntime({ spellCheck: false })
    const second = off.session()
    off.spellCheck.track(second)
    expect(second.calls).toEqual([false])
  })

  it('turns every tracked session off and on, saves the setting and then tells the shells', async () => {
    const runtime = spellCheckRuntime()
    const workspace = runtime.session()
    const home = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.spellCheck.track(home)
    runtime.order.length = 0

    await expect(runtime.spellCheck.setEnabled(false)).resolves.toMatchObject({ spellCheck: false })
    expect(runtime.settings().spellCheck).toBe(false)
    expect(runtime.order).toEqual(['session false', 'session false', 'published'])

    await runtime.spellCheck.setEnabled(true)
    expect(workspace.calls).toEqual([true, false, true])
    expect(home.calls).toEqual([true, false, true])
  })

  it('gives a session tracked while the change saves the new value, not the one still saved', async () => {
    const runtime = spellCheckRuntime()
    const late = runtime.session()
    runtime.whileSaving(() => runtime.spellCheck.track(late))
    await runtime.spellCheck.setEnabled(false)
    expect(late.calls).toEqual([false])
  })

  it('reads as the value a change applied while that change still saves, and as the saved one after a failure', async () => {
    const runtime = spellCheckRuntime()
    const seen: boolean[] = []
    runtime.whileSaving(() => { seen.push(runtime.spellCheck.isEnabled()) })
    await runtime.spellCheck.setEnabled(false)
    expect(seen).toEqual([false])
    expect(runtime.spellCheck.isEnabled()).toBe(false)

    runtime.failSaves()
    await expect(runtime.spellCheck.setEnabled(true)).rejects.toThrow('disk full')
    expect(seen).toEqual([false, true])
    expect(runtime.spellCheck.isEnabled()).toBe(false)
  })

  it('checks spelling in every session the browser sets up, once each, after its permission handlers', () => {
    const runtime = spellCheckRuntime({ spellCheck: false })
    const steps: string[] = []
    const browserSession = createBrowserSession({
      text: (key) => key,
      effectiveDownloadDirectory: () => '',
      showDialog: async () => ({ response: 0 }),
      workspaces: () => [],
      state: { persistentSession: null, sitePermissionStore: null },
      sendToShellWindows: () => undefined,
      partition: 'persist:test',
      websitesMaySaveFiles: () => false,
      trackSpellCheck: (session) => runtime.spellCheck.track(session)
    })
    const fakeSession = (name: string) => ({
      setDownloadPath: () => undefined,
      setPermissionCheckHandler: () => { steps.push(`${name} check handler`) },
      setPermissionRequestHandler: () => { steps.push(`${name} request handler`) },
      on: () => undefined,
      setSpellCheckerEnabled: (enabled: boolean) => { steps.push(`${name} spell check ${enabled}`) },
      getSpellCheckerLanguages: () => ['en-US'],
      setSpellCheckerLanguages: (languages: string[]) => { steps.push(`${name} languages ${languages.join(',')}`) }
    }) as unknown as Session
    const workspace = fakeSession('workspace')
    const home = fakeSession('home')
    browserSession.configureBrowserSession(workspace, 'workspace')
    browserSession.configureBrowserSession(workspace, 'workspace')
    browserSession.configureBrowserSession(home)
    expect(steps).toEqual([
      'workspace check handler', 'workspace request handler', 'workspace spell check false',
      'home check handler', 'home request handler', 'home spell check false'
    ])
  })

  it('puts the sessions back when the setting cannot be saved', async () => {
    const runtime = spellCheckRuntime()
    const workspace = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.failSaves()
    await expect(runtime.spellCheck.setEnabled(false)).rejects.toThrow('disk full')
    expect(workspace.calls).toEqual([true, false, true])
    expect(runtime.settings().spellCheck).toBe(true)
    expect(runtime.host.publishSettings).not.toHaveBeenCalled()
    // A session tracked after the failure gets the setting that stayed.
    const later = runtime.session()
    runtime.spellCheck.track(later)
    expect(later.calls).toEqual([true])
  })

  it('takes only a boolean from a trusted shell over IPC', async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
    const setEnabled = vi.fn(async (enabled: boolean) => ({ ...DEFAULT_SETTINGS, spellCheck: enabled }))
    const assertTrustedSender = vi.fn((event: IpcMainInvokeEvent) => {
      if ((event as unknown as { untrusted?: boolean }).untrusted) throw new Error('untrusted sender')
    })
    registerSpellCheckIpc(ipcMain, {
      assertTrustedSender,
      setEnabled,
      languages: () => ({ available: DICTIONARIES, automatic: ['en-US'] }),
      setLanguages: async () => DEFAULT_SETTINGS
    })
    const invoke = (event: object, value: unknown) => Promise.resolve().then(() => handlers.get('settings:set-spell-check')!(event as IpcMainInvokeEvent, value))

    await expect(invoke({}, false)).resolves.toMatchObject({ spellCheck: false })
    expect(setEnabled).toHaveBeenLastCalledWith(false)
    await expect(invoke({}, 'off')).rejects.toThrow('Spell check must be a boolean')
    await expect(invoke({ untrusted: true }, true)).rejects.toThrow('untrusted sender')
    expect(setEnabled).toHaveBeenCalledOnce()
  })
})

describe('spell check languages', () => {
  it('picks the language for the locale when none is chosen, as Chromium does on a new profile', () => {
    expect(automaticSpellCheckLanguages('en-US', DICTIONARIES)).toEqual(['en-US'])
    expect(automaticSpellCheckLanguages('uk', DICTIONARIES)).toEqual(['uk'])
    expect(automaticSpellCheckLanguages('pt-BR', DICTIONARIES)).toEqual(['pt-BR'])
    expect(automaticSpellCheckLanguages('es-419', DICTIONARIES)).toEqual(['es-419'])
    // A locale whose region has no dictionary takes its language's, and one with none for its language American English.
    expect(automaticSpellCheckLanguages('de-AT', DICTIONARIES)).toEqual(['de'])
    expect(automaticSpellCheckLanguages('fr-CA', ['fr-FR', 'en-US'])).toEqual(['fr-FR'])
    expect(automaticSpellCheckLanguages('ja', DICTIONARIES)).toEqual(['en-US'])
    expect(automaticSpellCheckLanguages('ja', [])).toEqual([])
  })

  it('gives each session the chosen languages it has dictionaries for when it is tracked, once', () => {
    const runtime = spellCheckRuntime({ spellCheckLanguages: ['uk', 'xx-YY', 'en-GB'] })
    const workspace = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.spellCheck.track(workspace)
    expect(workspace.languageCalls).toEqual([['uk', 'en-GB']])
  })

  it('leaves a session that already checks the wanted languages as it is', () => {
    const automatic = spellCheckRuntime()
    const fresh = automatic.session(['en-US'])
    automatic.spellCheck.track(fresh)
    expect(fresh.languageCalls).toEqual([])

    const chosen = spellCheckRuntime({ spellCheckLanguages: ['uk', 'en-US'] })
    const restarted = chosen.session(['uk', 'en-US'])
    chosen.spellCheck.track(restarted)
    expect(restarted.languageCalls).toEqual([])
  })

  it('gives a session the automatic language again when none is chosen, though it kept others from before', () => {
    const runtime = spellCheckRuntime({}, { locale: 'uk' })
    const restarted = runtime.session(['de-DE', 'pt-PT'])
    runtime.spellCheck.track(restarted)
    expect(restarted.languages()).toEqual(['uk'])
    // Chosen languages Chromium no longer has dictionaries for count as none.
    const missing = spellCheckRuntime({ spellCheckLanguages: ['xx-YY'] }, { locale: 'uk' })
    const other = missing.session(['en-US'])
    missing.spellCheck.track(other)
    expect(other.languages()).toEqual(['uk'])
  })

  it('leaves the languages to the system where Chromium has no dictionaries, as on macOS', async () => {
    const runtime = spellCheckRuntime({ spellCheckLanguages: ['uk'] }, { available: [] })
    const workspace = runtime.session([])
    runtime.spellCheck.track(workspace)
    expect(runtime.spellCheck.languages()).toEqual({ available: [], automatic: [] })
    await runtime.spellCheck.setLanguages(['de'])
    runtime.spellCheck.applyLanguages([])
    expect(workspace.languageCalls).toEqual([])
    expect(workspace.calls).toEqual([true])
  })

  it('offers the languages with dictionaries and the automatic one', () => {
    expect(spellCheckRuntime({}, { locale: 'de-AT' }).spellCheck.languages()).toEqual({ available: DICTIONARIES, automatic: ['de'] })
  })

  it('gives every tracked session new languages, saves them and then tells the shells', async () => {
    const runtime = spellCheckRuntime()
    const workspace = runtime.session()
    const home = runtime.session()
    runtime.spellCheck.track(workspace)
    runtime.spellCheck.track(home)
    runtime.order.length = 0

    await expect(runtime.spellCheck.setLanguages(['en-US', 'uk'])).resolves.toMatchObject({ spellCheckLanguages: ['en-US', 'uk'] })
    expect(runtime.settings().spellCheckLanguages).toEqual(['en-US', 'uk'])
    expect(runtime.order).toEqual(['session languages en-US,uk', 'session languages en-US,uk', 'published'])

    runtime.spellCheck.applyLanguages([])
    expect(workspace.languages()).toEqual(['en-US'])
    expect(home.languages()).toEqual(['en-US'])
  })

  it('gives a session tracked while new languages save those, and puts the sessions back when they cannot be saved', async () => {
    const runtime = spellCheckRuntime()
    const late = runtime.session()
    runtime.whileSaving(() => runtime.spellCheck.track(late))
    await runtime.spellCheck.setLanguages(['uk'])
    expect(late.languages()).toEqual(['uk'])

    runtime.failSaves()
    runtime.whileSaving(() => undefined)
    await expect(runtime.spellCheck.setLanguages(['de', 'fr'])).rejects.toThrow('disk full')
    expect(late.languageCalls).toEqual([['uk'], ['de', 'fr'], ['uk']])
    expect(runtime.settings().spellCheckLanguages).toEqual(['uk'])
    const later = runtime.session()
    runtime.spellCheck.track(later)
    expect(later.languages()).toEqual(['uk'])
  })

  it('reads the languages and takes only different languages with dictionaries from a trusted shell over IPC', async () => {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (channel: string, handler: Handler) => { handlers.set(channel, handler) } } as unknown as IpcMain
    const setLanguages = vi.fn(async (languages: readonly string[]) => ({ ...DEFAULT_SETTINGS, spellCheckLanguages: [...languages] }))
    const assertTrustedSender = vi.fn((event: IpcMainInvokeEvent) => {
      if ((event as unknown as { untrusted?: boolean }).untrusted) throw new Error('untrusted sender')
    })
    registerSpellCheckIpc(ipcMain, {
      assertTrustedSender,
      setEnabled: async () => DEFAULT_SETTINGS,
      languages: () => ({ available: DICTIONARIES, automatic: ['en-US'] }),
      setLanguages
    })
    const invoke = (channel: string, event: object, ...values: unknown[]) =>
      Promise.resolve().then(() => handlers.get(channel)!(event as IpcMainInvokeEvent, ...values))

    await expect(invoke('settings:spell-check-languages', {})).resolves.toEqual({ available: DICTIONARIES, automatic: ['en-US'] })
    await expect(invoke('settings:spell-check-languages', { untrusted: true })).rejects.toThrow('untrusted sender')
    await expect(invoke('settings:set-spell-check-languages', {}, ['uk', 'en-US'])).resolves.toMatchObject({ spellCheckLanguages: ['uk', 'en-US'] })
    expect(setLanguages).toHaveBeenLastCalledWith(['uk', 'en-US'])
    // A sparse array, which IPC keeps: its hole is no language.
    const sparse: unknown[] = new Array(2)
    sparse[1] = 'uk'
    for (const invalid of [[], ['uk', 'uk'], ['xx-YY'], 'uk', [7], null, sparse]) {
      await expect(invoke('settings:set-spell-check-languages', {}, invalid)).rejects.toThrow('Spell check languages must be')
    }
    await expect(invoke('settings:set-spell-check-languages', { untrusted: true }, ['uk'])).rejects.toThrow('untrusted sender')
    expect(setLanguages).toHaveBeenCalledOnce()
  })
})
