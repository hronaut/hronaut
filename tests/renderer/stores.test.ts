import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { BrowserState, RendererSettingsState } from '../../src/shared/types.js'
import { useBrowserStore } from '../../src/renderer/src/stores/browser.js'
import { useSettingsStore } from '../../src/renderer/src/stores/settings.js'

function browserState(activeTabId: string | null = null): BrowserState {
  return {
    tabs: activeTabId
      ? [{
          id: activeTabId,
          title: 'Example',
          url: 'https://example.com/',
          loading: false,
          canGoBack: false,
          canGoForward: false,
          active: true,
          pinned: false,
          sleeping: false,
          humanInteractionLocked: false,
          preserveDiagnosticLogs: false,
          zoomPercent: 100,
          audible: false,
          muted: false,
          devToolsOpen: false
        }]
      : [],
    closedTabs: [],
    activeTabId,
    allHumanInteractionLocked: false,
    mcpUrl: 'http://127.0.0.1:47812/mcp',
    profilePath: '/profile',
    mcpTabGroups: [],
    savedTabGroups: []
  }
}

function settingsState(locale: 'en-US' | 'uk-UA' = 'en-US'): RendererSettingsState {
  return {
    settings: {
      theme: 'system',
      interfaceScale: 1.1,
      tabPosition: 'top',
      searchEngine: 'google',
      hideInTray: true,
      attentionSound: true,
      attentionSoundCue: 'warning',
      mcpAuthentication: false,
      mcpPort: 47_812,
      downloadDirectory: null,
      askWhereToSaveDownloads: false,
      memorySaverEnabled: true,
      memorySaverTimeoutMinutes: 60,
      checkForUpdatesOnStartup: true,
      languagePreference: locale
    },
    systemTheme: 'dark',
    systemLocale: locale,
    resolvedLocale: locale
  }
}

function deferred<Value>(): {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function installBrowserApi(options: {
  getState: () => Promise<BrowserState>
  onStateChanged: (listener: (state: BrowserState) => void) => () => void
  selectTab?: (tabId: string) => Promise<BrowserState>
}): void {
  Object.defineProperty(window, 'hronaut', { configurable: true, value: options })
}

function installSettingsApi(options: {
  getRendererState: () => Promise<RendererSettingsState>
  onRendererStateChanged: (listener: (state: RendererSettingsState) => void) => () => void
  resetAppearance?: () => Promise<RendererSettingsState>
  setLanguagePreference?: (preference: RendererSettingsState['settings']['languagePreference']) => Promise<RendererSettingsState>
}): void {
  Object.defineProperty(window, 'hronautSettings', { configurable: true, value: options })
}

describe('browser Pinia store lifecycle', () => {
  it('protects a newer IPC event from a stale initialization response and avoids duplicate subscriptions', async () => {
    const pending = deferred<BrowserState>()
    let listener: ((state: BrowserState) => void) | undefined
    const unsubscribe = vi.fn()
    const getState = vi.fn(() => pending.promise)
    const onStateChanged = vi.fn((next: (state: BrowserState) => void) => {
      listener = next
      return unsubscribe
    })
    installBrowserApi({ getState, onStateChanged })
    const store = useBrowserStore()

    const first = store.initialize()
    const second = store.initialize()
    expect(getState).toHaveBeenCalledTimes(1)
    expect(onStateChanged).toHaveBeenCalledTimes(1)
    listener?.(browserState('event-tab'))
    pending.resolve(browserState('stale-tab'))
    await Promise.all([first, second])

    expect(store.state.activeTabId).toBe('event-tab')
    expect(store.initialized).toBe(true)
    store.dispose()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('preserves a browser event delivered while the listener is being attached', async () => {
    installBrowserApi({
      getState: async () => browserState('stale-tab'),
      onStateChanged: (next) => {
        next(browserState('event-tab'))
        return vi.fn()
      }
    })
    const store = useBrowserStore()

    await store.initialize()

    expect(store.state.activeTabId).toBe('event-tab')
    store.dispose()
  })

  it('exposes initialization failure and retries with a fresh subscription', async () => {
    const failure = new Error('state unavailable')
    const getState = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(browserState('recovered'))
    const unsubscribers = [vi.fn(), vi.fn()]
    let subscriptionIndex = 0
    const onStateChanged = vi.fn((_listener: (state: BrowserState) => void) => unsubscribers[subscriptionIndex++] ?? vi.fn())
    installBrowserApi({ getState, onStateChanged })
    const store = useBrowserStore()

    await expect(store.initialize()).rejects.toBe(failure)
    expect(store.initialized).toBe(false)
    expect(store.initializationError).toBe(failure)
    expect(unsubscribers[0]).toHaveBeenCalledOnce()
    await store.initialize()
    expect(store.state.activeTabId).toBe('recovered')
    expect(onStateChanged).toHaveBeenCalledTimes(2)
  })

  it('delegates actions and does not apply events after disposal', async () => {
    let listener: ((state: BrowserState) => void) | undefined
    const selectTab = vi.fn(async (tabId: string) => browserState(tabId))
    installBrowserApi({
      getState: async () => browserState(),
      onStateChanged: (next) => {
        listener = next
        return vi.fn()
      },
      selectTab
    })
    const store = useBrowserStore()
    await store.initialize()
    await store.selectTab('selected')
    expect(selectTab).toHaveBeenCalledWith('selected')
    expect(store.activeTab?.id).toBe('selected')
    store.dispose()
    listener?.(browserState('ignored'))
    await nextTick()
    expect(store.state.activeTabId).toBe('selected')
  })

  it('does not let a delayed action response overwrite a newer browser event', async () => {
    const action = deferred<BrowserState>()
    let listener: ((state: BrowserState) => void) | undefined
    installBrowserApi({
      getState: async () => browserState('initial'),
      onStateChanged: (next) => {
        listener = next
        return vi.fn()
      }
    })
    const store = useBrowserStore()
    await store.initialize()

    const syncing = store.syncOperation(action.promise)
    listener?.(browserState('newer-event'))
    action.resolve(browserState('stale-response'))
    await syncing

    expect(store.state.activeTabId).toBe('newer-event')
    store.dispose()
  })

  it('does not let an older action response overwrite a newer response', async () => {
    installBrowserApi({
      getState: async () => browserState('initial'),
      onStateChanged: () => vi.fn()
    })
    const store = useBrowserStore()
    await store.initialize()
    const older = deferred<BrowserState>()
    const newer = deferred<BrowserState>()

    const olderSync = store.syncOperation(older.promise)
    const newerSync = store.syncOperation(newer.promise)
    newer.resolve(browserState('newer-response'))
    await newerSync
    older.resolve(browserState('older-response'))
    await olderSync

    expect(store.state.activeTabId).toBe('newer-response')
    store.dispose()
  })

  it('ignores an action response that settles after disposal', async () => {
    installBrowserApi({
      getState: async () => browserState('initial'),
      onStateChanged: () => vi.fn()
    })
    const store = useBrowserStore()
    await store.initialize()
    const action = deferred<BrowserState>()
    const syncing = store.syncOperation(action.promise)

    store.dispose()
    action.resolve(browserState('disposed-response'))
    await syncing

    expect(store.state.activeTabId).toBe('initial')
  })
})

describe('settings Pinia store lifecycle', () => {
  it('accepts one authoritative renderer snapshot from an Appearance reset', async () => {
    const resetState: RendererSettingsState = {
      ...settingsState('en-US'),
      settings: {
        ...settingsState('en-US').settings,
        interfaceScale: 1,
        languagePreference: 'system'
      }
    }
    const resetAppearance = vi.fn(async () => resetState)
    installSettingsApi({
      getRendererState: async () => settingsState('uk-UA'),
      onRendererStateChanged: () => vi.fn(),
      resetAppearance
    })
    const store = useSettingsStore()
    await store.initialize()

    await expect(store.resetAppearance()).resolves.toEqual(resetState)

    expect(resetAppearance).toHaveBeenCalledOnce()
    expect(store.settings.interfaceScale).toBe(1)
    expect(store.settings.languagePreference).toBe('system')
    expect(store.resolvedLocale).toBe('en-US')
    store.dispose()
  })

  it('keeps settings, system theme, and locale synchronized without an initialization race', async () => {
    const pending = deferred<RendererSettingsState>()
    let listener: ((state: RendererSettingsState) => void) | undefined
    installSettingsApi({
      getRendererState: () => pending.promise,
      onRendererStateChanged: (next) => {
        listener = next
        return vi.fn()
      }
    })
    const store = useSettingsStore()
    const initializing = store.initialize()
    listener?.(settingsState('uk-UA'))
    pending.resolve(settingsState('en-US'))
    await initializing

    expect(store.resolvedLocale).toBe('uk-UA')
    expect(store.systemTheme).toBe('dark')
    expect(store.settings.languagePreference).toBe('uk-UA')
  })

  it('preserves settings delivered while the listener is being attached', async () => {
    installSettingsApi({
      getRendererState: async () => settingsState('en-US'),
      onRendererStateChanged: (next) => {
        next(settingsState('uk-UA'))
        return vi.fn()
      }
    })
    const store = useSettingsStore()

    await store.initialize()

    expect(store.resolvedLocale).toBe('uk-UA')
    expect(store.settings.languagePreference).toBe('uk-UA')
    store.dispose()
  })

  it('unsubscribes on failure and can retry', async () => {
    const failure = new Error('settings unavailable')
    const getRendererState = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(settingsState())
    const unsubscribe = vi.fn()
    installSettingsApi({ getRendererState, onRendererStateChanged: () => unsubscribe })
    const store = useSettingsStore()

    await expect(store.initialize()).rejects.toBe(failure)
    expect(unsubscribe).toHaveBeenCalledOnce()
    await store.initialize()
    expect(store.initialized).toBe(true)
    expect(getRendererState).toHaveBeenCalledTimes(2)
  })

  it('does not let an older settings response overwrite a newer response', async () => {
    installSettingsApi({
      getRendererState: async () => settingsState(),
      onRendererStateChanged: () => vi.fn()
    })
    const store = useSettingsStore()
    await store.initialize()
    const older = deferred<RendererSettingsState['settings']>()
    const newer = deferred<RendererSettingsState['settings']>()

    const olderApply = store.applySettings(older.promise)
    const newerApply = store.applySettings(newer.promise)
    newer.resolve({ ...settingsState().settings, theme: 'dark' })
    await newerApply
    older.resolve({ ...settingsState().settings, theme: 'light' })
    await olderApply

    expect(store.settings.theme).toBe('dark')
    store.dispose()
  })

  it('ignores a settings response that settles after disposal', async () => {
    installSettingsApi({
      getRendererState: async () => settingsState(),
      onRendererStateChanged: () => vi.fn()
    })
    const store = useSettingsStore()
    await store.initialize()
    const operation = deferred<RendererSettingsState['settings']>()
    const applying = store.applySettings(operation.promise)

    store.dispose()
    operation.resolve({ ...settingsState().settings, theme: 'dark' })
    await applying

    expect(store.settings.theme).toBe('system')
  })

  it('ignores a locale response that settles after disposal', async () => {
    const operation = deferred<RendererSettingsState>()
    installSettingsApi({
      getRendererState: async () => settingsState(),
      onRendererStateChanged: () => vi.fn(),
      setLanguagePreference: () => operation.promise
    })
    const store = useSettingsStore()
    await store.initialize()
    const changing = store.setLanguagePreference('uk-UA')

    store.dispose()
    operation.resolve(settingsState('uk-UA'))
    await changing

    expect(store.resolvedLocale).toBe('en-US')
    expect(store.settings.languagePreference).toBe('en-US')
  })
})
