import { isActiveDownload } from '../../../shared/download-state.js'
import { isHronautHomeUrl } from '../../../shared/home-url.js'
import { tabTitleForDisplay } from '../../../shared/tab-title.js'
import { computed, toRaw, type Ref } from 'vue'
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
  const regularTabs = computed(() => options.state.value.tabs.filter((tab) => !isHronautHomeUrl(tab.url)))
  const activeIsHome = computed(() => (
    !options.state.value.activeTabId || isHronautHomeUrl(options.activeTab.value?.url) === true
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
  // The decisions that apply to the shown tab: its workspace's decisions for the page's own website and for websites
  // embedded in the page. A tab outside a workspace gets no permission, so none applies.
  const activeSitePermissions = computed(() => {
    const origin = activeOrigin.value
    const workspaceId = options.activeTab.value?.mcpGroupId
    if (!origin || !workspaceId) return []
    return options.sitePermissions.value.filter((entry) => entry.workspaceId === workspaceId
      && (entry.embeddedIn === undefined ? entry.origin === origin : entry.embeddedIn === origin))
  })
  const activeAddressKind = computed(() => (
    options.translate(activeWebUrl.value?.startsWith('https:') ? 'runtime.address.https' : 'runtime.address.http')
  ))
  const activeCredentials = computed(() => (
    options.credentials.value.filter((credential) => credential.origin === activeOrigin.value)
  ))
  const activeDownloads = computed(() => options.downloads.value.filter((download) => isActiveDownload(download)))
  /** The downloads of this run, which the toolbar's button counts; those kept from before the restart stay in the panel. */
  const toolbarDownloads = computed(() => options.downloads.value.filter((download) => !download.fromEarlierRun))
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
    const latest = toolbarDownloads.value[0]
    if (latest?.state === 'completed' && !latest.fileRemoved) {
      return options.translate('runtime.downloads.complete', { filename: latest.filename })
    }
    if (toolbarDownloads.value.length) return options.translate('runtime.downloads.recent')
    return options.translate('runtime.downloads.heading')
  })
  const tabHumanInteractionLocked = computed(() => options.activeTab.value?.humanInteractionInputLocked
    ?? (options.state.value.allHumanInteractionLocked || options.activeTab.value?.humanInteractionLocked === true))
  const effectiveHumanInteractionLocked = computed(() => (
    tabHumanInteractionLocked.value
  ))
  const tabInteractionLockLabel = computed(() => {
    if (activeIsHome.value) return options.translate('runtime.locks.websiteOnly')
    return options.translate(tabHumanInteractionLocked.value ? 'runtime.locks.unlockTab' : 'runtime.locks.lockTab')
  })
  const allInteractionLockLabel = computed(() => (
    options.translate(options.state.value.allHumanInteractionLocked ? 'runtime.locks.unlockAll' : 'runtime.locks.lockAll')
  ))

  // The words a tab's tooltip may use, translated once for the interface language rather than again for each tab.
  const tooltipWords = computed(() => ({
    newTab: options.translate('tabSearch.newTabTitle'),
    uncertainLabel: options.translate('tabLabel.uncertain'),
    pinned: options.translate('runtimeDetails.tab.pinned'),
    sleeping: options.translate('runtimeDetails.tab.sleeping'),
    frozen: options.translate('runtimeDetails.tab.frozen'),
    freezeUnknown: options.translate('runtimeDetails.tab.freezeUnknown'),
    muted: options.translate('runtimeDetails.tab.muted'),
    audio: options.translate('runtimeDetails.tab.audio'),
    locked: options.translate('runtimeDetails.tab.locked'),
    routesUnconfirmed: options.translate('network.conditions.unconfirmed'),
    split: options.translate('runtimeDetails.tab.split')
  }))
  // The shell reads every tab's tooltip whenever the browser state changes, though most tabs did not, and the store
  // keeps each unchanged tab as the same object. A tooltip is kept until its tab, the interface language, or the lock
  // or split view it mentions changes.
  const tooltips = new WeakMap<BrowserTabState, { words: object; locked: boolean; split: boolean; tooltip: string }>()

  function tabTooltip(tab: BrowserTabState): string {
    const words = tooltipWords.value
    const locked = tab.humanInteractionInputLocked
      ?? (options.state.value.allHumanInteractionLocked || tab.humanInteractionLocked)
    const split = options.state.value.splitView?.firstTabId === tab.id
      || options.state.value.splitView?.secondTabId === tab.id
    const key = toRaw(tab)
    const kept = tooltips.get(key)
    if (kept?.words === words && kept.locked === locked && kept.split === split) return kept.tooltip
    const tooltip = describeTab(tab, words, locked, split)
    tooltips.set(key, { words, locked, split, tooltip })
    return tooltip
  }

  function describeTab(tab: BrowserTabState, words: typeof tooltipWords.value, locked: boolean, split: boolean): string {
    const pageLifecycle = tab.pageLifecycleState === 'frozen'
      ? words.frozen
      : tab.pageLifecycleState === 'unknown' ? words.freezeUnknown : ''
    const audio = tab.muted ? words.muted : tab.audible ? words.audio : ''
    const problem = tab.pageProblem
      ? options.translate('runtimeDetails.tab.problem', { problem: tab.pageProblem.title })
      : ''
    const emulation = tab.emulation
      ? options.translate('runtimeDetails.tab.emulated', { description: options.describeEmulation(tab.emulation) })
      : ''
    const networkRoutes = tab.networkConditionState && tab.networkConditionState.application !== 'confirmed'
      ? words.routesUnconfirmed
      : tab.networkRouteCount
      ? options.translate(
        'runtimeDetails.tab.routes',
        { count: options.formatNumber(tab.networkRouteCount) },
        tab.networkRouteCount
      )
      : ''
    const workspace = tab.mcpGroupName
      ? options.translate('runtimeDetails.tab.workspace', { name: tab.mcpGroupName })
      : ''
    const title = tabTitleForDisplay(tab, words.newTab)
    return `${tab.label ? `${tab.label}\n${title}\n${tab.url}` : title}${tab.labelDurabilityUnconfirmed ? `\n${words.uncertainLabel}` : ''}${problem}${tab.pinned ? words.pinned : ''}${tab.sleeping ? words.sleeping : ''}${pageLifecycle}${audio}${locked ? words.locked : ''}${emulation}${networkRoutes}${split ? words.split : ''}${workspace}`
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
    toolbarDownloads,
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
