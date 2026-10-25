import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { translate } from '../../../shared/i18n.js'
import { DEFAULT_INTERFACE_SCALE } from '../../../shared/interface-scale.js'
import { DEFAULT_TAB_POSITION } from '../../../shared/tab-position.js'
import type { WindowMaterial } from '../../../shared/window-material.js'
import type { SiteSearchDraft } from '../../../shared/site-search.js'
import type { SecureDnsMode } from '../../../shared/secure-dns.js'
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
  theme: 'cyberpunk',
  interfaceScale: DEFAULT_INTERFACE_SCALE,
  tabPosition: DEFAULT_TAB_POSITION,
  useSystemTitleBar: false,
  searchEngine: 'google',
  siteSearches: [],
  secureDnsMode: 'automatic',
  secureDnsTemplate: '',
  hideInTray: true,
  launchAtStartup: false,
  launchMinimized: false,
  attentionSound: true,
  attentionSoundCue: 'warning',
  challengeDetectionEnabled: false,
  omitAgentUrlDetail: false,
  allowWebsiteFileSaving: false,
  followAgentActivity: false,
  showAgentCursor: true,
  pinAgentLiveStatus: false,
  mcpRemoteAccess: false,
  mcpAuthentication: true,
  mcpPort: 47_812,
  mcpToolSet: 'essentials',
  downloadDirectory: null,
  askWhereToSaveDownloads: false,
  memorySaverEnabled: true,
  memorySaverTimeoutMinutes: 60,
  graphicsAcceleration: true,
  checkForUpdatesOnStartup: true,
  languagePreference: 'system'
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AppSettings>({ ...DEFAULT_RENDERER_SETTINGS })
  const systemTheme = ref<'light' | 'dark'>('light')
  const windowMaterial = ref<WindowMaterial | null>(null)
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
    windowMaterial.value = next.windowMaterial ?? null
    systemLocale.value = next.systemLocale
    resolvedLocale.value = next.resolvedLocale
  }

  function detachListener(): void {
    const current = unsubscribe
    unsubscribe = null
    current?.()
  }

  function hydrate(next: RendererSettingsState): void {
    settings.value = next.settings
    systemTheme.value = next.systemTheme
    windowMaterial.value = next.windowMaterial ?? null
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
        // Invalidate the callback before native cleanup. An unsubscribe
        // failure can leave the callback alive, but it must stay inert.
        generation += 1
        initializePromise = null
        initializing.value = false
        initializationError.value = error
        initialized.value = false
        const failures = [error]
        try {
          detachListener()
        } catch (cleanupError) {
          failures.push(cleanupError)
        }
        if (failures.length === 1) throw error
        // The startup toast shows this message, so it speaks the language the settings were hydrated with.
        throw new AggregateError(failures, translate(resolvedLocale.value, 'appErrors.startup.settingsCleanupIncomplete'))
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
    initializePromise = null
    initialized.value = false
    initializing.value = false
    detachListener()
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
  async function resetGeneral(): Promise<RendererSettingsState> {
    const currentGeneration = generation
    const startingRevision = revision
    const sequence = ++mutationSequence
    const next = await window.hronautSettings.resetGeneral()
    if (
      generation === currentGeneration
      && revision === startingRevision
      && sequence === mutationSequence
    ) acceptAuthoritativeState(next)
    return next
  }
  const setInterfaceScale = (scale: InterfaceScale): Promise<AppSettings> => applySettings(window.hronautSettings.setInterfaceScale(scale))
  const setTabPosition = (position: TabPosition): Promise<AppSettings> => applySettings(window.hronautSettings.setTabPosition(position))
  const setUseSystemTitleBar = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setUseSystemTitleBar(enabled))
  const setSearchEngine = (engine: SearchEngineName): Promise<AppSettings> => applySettings(window.hronautSettings.setSearchEngine(engine))
  const addSiteSearch = (draft: SiteSearchDraft): Promise<AppSettings> => applySettings(window.hronautSettings.addSiteSearch(draft))
  const updateSiteSearch = (id: string, draft: SiteSearchDraft): Promise<AppSettings> => applySettings(window.hronautSettings.updateSiteSearch(id, draft))
  const removeSiteSearch = (id: string): Promise<AppSettings> => applySettings(window.hronautSettings.removeSiteSearch(id))
  const setSecureDns = (mode: SecureDnsMode, template: string): Promise<AppSettings> => applySettings(window.hronautSettings.setSecureDns(mode, template))
  const setHideInTray = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setHideInTray(enabled))
  const setLaunchAtStartup = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setLaunchAtStartup(enabled))
  const setLaunchMinimized = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setLaunchMinimized(enabled))
  const setAttentionSound = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setAttentionSound(enabled))
  const setAttentionSoundCue = (cue: AttentionSoundCue): Promise<AppSettings> => applySettings(window.hronautSettings.setAttentionSoundCue(cue))
  const setFollowAgentActivity = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setFollowAgentActivity(enabled))
  const setShowAgentCursor = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setShowAgentCursor(enabled))
  const setPinAgentLiveStatus = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setPinAgentLiveStatus(enabled))
  const setChallengeDetectionEnabled = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setChallengeDetectionEnabled(enabled))
  const setOmitAgentUrlDetail = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setOmitAgentUrlDetail(enabled))
  const setAllowWebsiteFileSaving = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setAllowWebsiteFileSaving(enabled))
  const setMcpRemoteAccess = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpRemoteAccess(enabled))
  const setMcpAuthentication = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpAuthentication(enabled))
  const setMcpPort = (port: number): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpPort(port))
  const setMcpToolSet = (toolSet: AppSettings['mcpToolSet']): Promise<AppSettings> => applySettings(window.hronautSettings.setMcpToolSet(toolSet))
  const resetMcp = (): Promise<AppSettings> => applySettings(window.hronautSettings.resetMcp())
  const setAskWhereToSaveDownloads = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setAskWhereToSaveDownloads(enabled))
  const resetDownloads = (): Promise<AppSettings> => applySettings(window.hronautSettings.resetDownloads())
  const setMemorySaverEnabled = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setMemorySaverEnabled(enabled))
  const setMemorySaverTimeoutMinutes = (minutes: MemorySaverTimeoutMinutes): Promise<AppSettings> => applySettings(window.hronautSettings.setMemorySaverTimeoutMinutes(minutes))
  const resetMemorySaver = (): Promise<AppSettings> => applySettings(window.hronautSettings.resetMemorySaver())
  const setGraphicsAcceleration = (enabled: boolean): Promise<AppSettings> => applySettings(window.hronautSettings.setGraphicsAcceleration(enabled))
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
    windowMaterial,
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
    resetGeneral,
    setTheme,
    setInterfaceScale,
    setTabPosition,
    setUseSystemTitleBar,
    setSearchEngine,
    addSiteSearch,
    updateSiteSearch,
    removeSiteSearch,
    setSecureDns,
    setHideInTray,
    setLaunchAtStartup,
    setLaunchMinimized,
    setAttentionSound,
    setAttentionSoundCue,
    setFollowAgentActivity,
    setShowAgentCursor,
    setPinAgentLiveStatus,
    setChallengeDetectionEnabled,
    setOmitAgentUrlDetail,
    setAllowWebsiteFileSaving,
    setMcpRemoteAccess,
    setMcpAuthentication,
    setMcpPort,
    setMcpToolSet,
    resetMcp,
    setAskWhereToSaveDownloads,
    resetDownloads,
    setMemorySaverEnabled,
    setMemorySaverTimeoutMinutes,
    resetMemorySaver,
    setGraphicsAcceleration,
    setCheckForUpdatesOnStartup,
    setLanguagePreference
  }
})
