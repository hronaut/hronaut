import type { WebContents } from 'electron'
import type { MessageKey, MessageParameters } from '../../../shared/i18n.js'
import type { SupportedLocale } from '../../../shared/locale.js'
import type { BrowserConsoleMessage, BrowserPageLifecycleState, BrowserPageProblem } from '../../../shared/types.js'

/**
 * The tab fields a renderer exit or hang changes: the page's state, its
 * emulation and native input generations, its request-condition application,
 * its lifecycle and the problem it shows.
 */
export interface RendererHealthEventsTab {
  id: string
  title: string
  url: string
  loading: boolean
  networkConditionApplication: 'confirmed' | 'pending' | 'unknown'
  emulationApplication: 'confirmed' | 'pending' | 'unknown'
  emulationRevision: number
  emulationContextGeneration: number
  nativeInputEnvironmentGeneration: number
  pageLifecycleState: BrowserPageLifecycleState
  pageLifecycleUnknownRequest?: Exclude<BrowserPageLifecycleState, 'unknown'>
  pageProblem?: BrowserPageProblem
}

/** The tab manager option renderer health uses to localize the problem it shows. */
export interface RendererHealthEventsOptions {
  getLocale: () => SupportedLocale
}

/**
 * What following a page's renderer exits and hangs needs from the tab
 * manager, which keeps request conditions, emulation sizing, tab overview
 * previews, renderer recovery, network waits, native selection sessions,
 * localized text, its options, console messages and state publication
 * private. Each member reads the manager when the renderer event arrives.
 */
export interface RendererHealthEventsAccess<Tab extends RendererHealthEventsTab> {
  /** Marks the tab's native request-condition application unknown. */
  markNetworkConditionsUnknown(tab: Tab): void
  /** Publishes the browser state, and saves it unless persist is false. */
  changed(persist?: boolean): void
  /** Sizes the tab's view for an emulated viewport, or lets it fill its space when undefined. */
  setEmulationViewSize(tab: Tab, viewport: { width: number; height: number } | undefined): void
  /** Drops the tab's overview preview, which no longer shows the page. */
  invalidateTabOverviewPreview(tab: Tab): void
  /** The queue of overview preview captures. */
  tabOverviewPreviewCaptures(): { cancelPending(tabId: string): void }
  /** The ids of tabs whose page can be shown in the tab overview. */
  tabOverviewPreviewableTabs(): Set<string>
  /** Renderer recovery, which expects the exits it causes. */
  rendererRecovery(): { expectsExit(contents: WebContents): boolean }
  /** Whether the person ended the page's process in the Task manager, forgetting it, so the tab says so once. */
  takeEndedByPerson(contents: WebContents): boolean
  /** The waits for network activity. */
  networkWaitController(): { reject(tabId: string, message: string): void }
  /** Cancels the tab's screenshot area selection and element picker. */
  cancelNativeSelectionSessions(tab: Tab): void
  /** Localized text for the person. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The tab manager's options. */
  options(): RendererHealthEventsOptions
  /** Appends a lifecycle message to the tab's console messages. */
  appendConsoleMessage(tab: Tab, message: BrowserConsoleMessage, source: 'lifecycle'): void
}
