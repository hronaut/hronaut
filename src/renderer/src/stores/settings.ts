import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_INTERFACE_SCALE } from '../../../shared/interface-scale.js'
import type {
  AppSettings,
  AttentionSoundCue,
  InterfaceScale,
  LanguagePreference,
  MemorySaverTimeoutMinutes,
  RendererSettingsState,
  SearchEngineName,
  SupportedLocale,
  TabPosition,
  ThemeName
} from '../../../shared/types.js'

export const DEFAULT_RENDERER_SETTINGS: AppSettings = {
  theme: 'system',
  interfaceScale: DEFAULT_INTERFACE_SCALE,
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
  languagePreference: 'system'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const systemTheme = ref<'light' | 'dark'>('light')
  const systemLocale = ref<SupportedLocale>('en-US')
  const resolvedLocale = ref<SupportedLocale>('en-US')
  const initialized = ref(false)
  const initializing = ref(false)
  const initializationError = ref<unknown>(null)
  const languageChangeError = ref<unknown>(null)
  const effectiveTheme = computed(() => settings.value.theme === 'system' ? systemTheme.value : settings.value.theme)

  let generation = 0
  let revision = 0
  let mutationSequence = 0
  let initializePromise: Promise<void> | null = null
  let unsubscribe: (() => void) | null = null

  function acceptAuthoritativeState(next: RendererSettingsState): void {
    revision += 1
    settings.value = next.settings
    systemTheme.value = next.systemTheme
    systemLocale.value = next.systemLocale
    resolvedLocale.value = next.resolvedLocale
  }

  function hydrate(next: RendererSettingsState): void {
    settings.value = next.settings
    systemTheme.value = next.systemTheme
    systemLocale.value = next.systemLocale
    resolvedLocale.value = next.resolvedLocale
  }

  function acceptSettings(next: AppSettings): void {
    revision += 1
    settings.value = next
  }

  async function initialize(): Promise<void> {
    if (initialized.value) return
    if (initializePromise) return initializePromise
    const currentGeneration = ++generation
    initializing.value = true
    initializationError.value = null
    const initialRevision = revision
    unsubscribe = window.hronautSettings.onRendererStateChanged((next) => {
      if (generation === currentGeneration) acceptAuthoritativeState(next)
    })
    initializePromise = window.hronautSettings.getRendererState()
      .then((next) => {
        if (generation !== currentGeneration) return
        if (revision === initialRevision) acceptAuthoritativeState(next)
        initialized.value = true
      })
      .catch((error: unknown) => {
        if (generation !== currentGeneration) return
        unsubscribe?.()
        unsubscribe = null
        initializationError.value = error
        initialized.value = false
        throw error
      })
      .finally(() => {
        if (generation === currentGeneration) {
          initializePromise = null
          initializing.value = false
        }
      })
    return initializePromise
  }

  function dispose(): void {
    generation += 1
    unsubscribe?.()
    unsubscribe = null
    initializePromise = null
    initialized.value = false
    initializing.value = false
  }

  async function applySettings(operation: Promise<AppSettings>): Promise<AppSettings> {
    const currentGeneration = generation
    const startingRevision = revision
    const sequence = ++mutationSequence
    const next = await operation
    if (
      generation === currentGeneration
      && revision === startingRevision
      && sequence === mutationSequence
    ) acceptSettings(next)
    return next
  }

  const setTheme = (theme: ThemeName): Promise<AppSettings> => applySettings(window.hronautSettings.setTheme(theme))
  async function resetAppearance(): Promise<RendererSettingsState> {
    const currentGeneration = generation
    const startingRevision = revision
    const sequence = ++mutationSequence
    const next = await window.hronautSettings.resetAppearance()
    if (
      generation === currentGeneration
      && revision === startingRevision
      && sequence === mutationSequence
    ) acceptAuthoritativeState(next)
    return next
  }
  const setInterfaceScale = (scale: InterfaceScale): Promise<AppSettings> => applySettings(window.hronautSettings.setInterfaceScale(scale))
  const setTabPosition = (position: TabPosition): Promise<AppSettings> => applySettings(window.hronautSettings.setTabPosition(position))
  const setSearchEngine = (engine: SearchEngineName): Promise<AppSettings> => applySettings(window.hronautSettings.setSearchEngine(engine))
  const setHideInTray = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setHideInTray(enabled))
  const setAttentionSound = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setAttentionSound(enabled))
  const setAttentionSoundCue = (cue: AttentionSoundCue): Promise<AppSettings> => applySettings(window.hronautSettings.setAttentionSoundCue(cue))
  const setMcpAuthentication = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpAuthentication(enabled))
  const setMcpPort = (port: number): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpPort(port))
  const setAskWhereToSaveDownloads = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setAskWhereToSaveDownloads(enabled))
  const resetDownloads = (): Promise<AppSettings> => applySettings(window.hronautSettings.resetDownloads())
  const setMemorySaverEnabled = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setMemorySaverEnabled(enabled))
  const setMemorySaverTimeoutMinutes = (minutes: MemorySaverTimeoutMinutes): Promise<AppSettings> => applySettings(window.hronautSettings.setMemorySaverTimeoutMinutes(minutes))
  const setCheckForUpdatesOnStartup = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setCheckForUpdatesOnStartup(enabled))

  async function setLanguagePreference(preference: LanguagePreference): Promise<RendererSettingsState> {
    const currentGeneration = generation
    const startingRevision = revision
    const sequence = ++mutationSequence
    languageChangeError.value = null
    try {
      const next = await window.hronautSettings.setLanguagePreference(preference)
      if (
        generation === currentGeneration
        && revision === startingRevision
        && sequence === mutationSequence
      ) acceptAuthoritativeState(next)
      return next
    } catch (error) {
      if (generation === currentGeneration && sequence === mutationSequence) languageChangeError.value = error
      throw error
    }
  }

  return {
    settings,
    systemTheme,
    systemLocale,
    resolvedLocale,
    effectiveTheme,
    initialized,
    initializing,
    initializationError,
    languageChangeError,
    hydrate,
    initialize,
    dispose,
    acceptAuthoritativeState,
    applySettings,
    resetAppearance,
    setTheme,
    setInterfaceScale,
    setTabPosition,
    setSearchEngine,
    setHideInTray,
    setAttentionSound,
    setAttentionSoundCue,
    setMcpAuthentication,
    setMcpPort,
    setAskWhereToSaveDownloads,
    resetDownloads,
    setMemorySaverEnabled,
    setMemorySaverTimeoutMinutes,
    setCheckForUpdatesOnStartup,
    setLanguagePreference
  }
})
