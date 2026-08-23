import { computed, type Ref } from 'vue'
import type {
  BrowserBookmark,
  BrowserDownloadState,
  BrowserEmulationState,
  BrowserState,
  BrowserTabState,
  CredentialSummary,
  SitePermissionEntry
} from '../../../shared/types.js'

type Translate = (key: string, parameters?: Record<string, unknown>, plural?: number) => string

export interface ActiveTabPresentationControllerOptions {
  state: Readonly<Ref<BrowserState>>
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  sitePermissions: Readonly<Ref<SitePermissionEntry[]>>
  credentials: Readonly<Ref<CredentialSummary[]>>
  downloads: Readonly<Ref<BrowserDownloadState[]>>
  bookmarks: Readonly<Ref<BrowserBookmark[]>>
  translate: Translate
  formatNumber: (value: number) => string
  describeEmulation: (emulation: BrowserEmulationState) => string
}

export function useActiveTabPresentationController(options: ActiveTabPresentationControllerOptions) {
  const regularTabs = computed(() => options.state.value.tabs.filter((tab) => !tab.url.startsWith('hronaut://home')))
  const activeIsHome = computed(() => (
    !options.state.value.activeTabId || options.activeTab.value?.url.startsWith('hronaut://home') === true
  ))
  const activeWebUrl = computed(() => {
    try {
      const url = new URL(options.activeTab.value?.url ?? '')
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
    } catch {
      return null
    }
  })
  const activeOrigin = computed(() => {
    try {
      const url = new URL(options.activeTab.value?.url ?? '')
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null
    } catch {
      return null
    }
  })
  const activeHostname = computed(() => {
    try {
      return new URL(activeWebUrl.value ?? '').hostname
    } catch {
      return ''
    }
  })
  const activeSitePermissions = computed(() => (
    activeOrigin.value
      ? options.sitePermissions.value.filter((entry) => entry.origin === activeOrigin.value)
      : []
  ))
  const activeAddressKind = computed(() => (
    options.translate(activeWebUrl.value?.startsWith('https:') ? 'runtime.address.https' : 'runtime.address.http')
  ))
  const activeCredentials = computed(() => (
    options.credentials.value.filter((credential) => credential.origin === activeOrigin.value)
  ))
  const activeDownloads = computed(() => options.downloads.value.filter((download) => download.state === 'progressing'))
  const activeTabUsesDefaultProfile = computed(() => {
    const workspaceId = options.activeTab.value?.mcpGroupId
    if (!workspaceId) return true
    return options.state.value.mcpTabGroups.find((workspace) => workspace.id === workspaceId)?.isDefault !== false
  })
  const currentBookmark = computed(() => (
    options.bookmarks.value.find((bookmark) => bookmark.url === activeWebUrl.value)
  ))
  const downloadButtonLabel = computed(() => {
    if (activeDownloads.value.length) {
      return options.translate(
        'runtime.downloads.progress',
        { count: options.formatNumber(activeDownloads.value.length) },
        activeDownloads.value.length
      )
    }
    if (options.downloads.value[0]?.state === 'completed') {
      return options.translate('runtime.downloads.complete', { filename: options.downloads.value[0].filename })
    }
    if (options.downloads.value.length) return options.translate('runtime.downloads.recent')
    return options.translate('runtime.downloads.heading')
  })
  const tabHumanInteractionLocked = computed(() => options.activeTab.value?.humanInteractionLocked === true)
  const effectiveHumanInteractionLocked = computed(() => (
    options.state.value.allHumanInteractionLocked || tabHumanInteractionLocked.value
  ))
  const tabInteractionLockLabel = computed(() => {
    if (activeIsHome.value) return options.translate('runtime.locks.websiteOnly')
    if (options.state.value.allHumanInteractionLocked) return options.translate('runtime.locks.allLocked')
    return options.translate(tabHumanInteractionLocked.value ? 'runtime.locks.unlockTab' : 'runtime.locks.lockTab')
  })
  const allInteractionLockLabel = computed(() => (
    options.translate(options.state.value.allHumanInteractionLocked ? 'runtime.locks.unlockAll' : 'runtime.locks.lockAll')
  ))

  function tabTooltip(tab: BrowserTabState): string {
    const pinned = tab.pinned ? options.translate('runtimeDetails.tab.pinned') : ''
    const sleeping = tab.sleeping ? options.translate('runtimeDetails.tab.sleeping') : ''
    const audio = tab.muted
      ? options.translate('runtimeDetails.tab.muted')
      : tab.audible ? options.translate('runtimeDetails.tab.audio') : ''
    const locked = options.state.value.allHumanInteractionLocked || tab.humanInteractionLocked
      ? options.translate('runtimeDetails.tab.locked')
      : ''
    const problem = tab.pageProblem
      ? options.translate('runtimeDetails.tab.problem', { problem: tab.pageProblem.title })
      : ''
    const emulation = tab.emulation
      ? options.translate('runtimeDetails.tab.emulated', { description: options.describeEmulation(tab.emulation) })
      : ''
    const networkRoutes = tab.networkRouteCount
      ? options.translate(
        'runtimeDetails.tab.routes',
        { count: options.formatNumber(tab.networkRouteCount) },
        tab.networkRouteCount
      )
      : ''
    const split = options.state.value.splitView?.firstTabId === tab.id
      || options.state.value.splitView?.secondTabId === tab.id
      ? options.translate('runtimeDetails.tab.split')
      : ''
    const workspace = tab.mcpGroupName
      ? options.translate('runtimeDetails.tab.workspace', { name: tab.mcpGroupName })
      : ''
    return `${tab.title || options.translate('tabSearch.newTabTitle')}${problem}${pinned}${sleeping}${audio}${locked}${emulation}${networkRoutes}${split}${workspace}`
  }

  function pageProblemDetails(tab: BrowserTabState): string {
    const problem = tab.pageProblem
    if (!problem) return ''
    if (problem.kind === 'load-error' && problem.errorDescription) {
      return `${problem.errorDescription}${problem.errorCode ? ` (${problem.errorCode})` : ''}`
    }
    if (problem.kind === 'renderer-gone' && problem.reason) {
      return problem.exitCode !== undefined
        ? options.translate('runtimeDetails.tab.exit', {
          reason: problem.reason,
          code: options.formatNumber(problem.exitCode)
        })
        : problem.reason
    }
    return ''
  }

  return {
    regularTabs,
    activeIsHome,
    activeWebUrl,
    activeOrigin,
    activeHostname,
    activeSitePermissions,
    activeAddressKind,
    activeCredentials,
    activeDownloads,
    activeTabUsesDefaultProfile,
    currentBookmark,
    downloadButtonLabel,
    tabHumanInteractionLocked,
    effectiveHumanInteractionLocked,
    tabInteractionLockLabel,
    allInteractionLockLabel,
    tabTooltip,
    pageProblemDetails
  }
}

export type ActiveTabPresentationController = ReturnType<typeof useActiveTabPresentationController>
