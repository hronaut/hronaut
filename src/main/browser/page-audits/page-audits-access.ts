import type { WebContents } from 'electron'
import type {
  BrowserAccessibilityAudit,
  BrowserInspectorIssuesReport,
  BrowserPageMetadataReport,
  BrowserPerformanceEnvironment,
  BrowserPerformanceReport,
  BrowserPwaOptions,
  BrowserPwaReport
} from '../../../shared/types.js'
import type { BrowserNetworkRecordingState } from '../network-recording.js'

/**
 * The tab fields page audits read and write: the accessibility and
 * performance baselines with their generations, and the connection security
 * the network recording keeps. The tab manager's navigation handling stays
 * authoritative for the navigation generation and soft navigations.
 */
export interface PageAuditsTab extends Pick<BrowserNetworkRecordingState, 'securitySnapshot'> {
  id: string
  title: string
  url: string
  webContents: WebContents
  navigationGeneration: number
  performanceDocumentRouted?: boolean
  accessibilityBaseline?: BrowserAccessibilityAudit
  accessibilityBaselineGeneration: number
  performanceBaseline?: {
    report: BrowserPerformanceReport
    environment: BrowserPerformanceEnvironment
    environmentFingerprint: string
  }
  performanceBaselineGeneration: number
}

/**
 * What page audits need from the tab manager, which keeps the tabs, the
 * tab's emulated environment, page metadata, PWA inspection and browser
 * issues private. The axe-core and web-vitals page script sources stay loaded
 * by the manager's module, so these modules have no load-time effects and
 * module evaluation order is unchanged.
 */
export interface PageAuditsAccess<Tab extends PageAuditsTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  axeSource(): string
  webVitalsSource(): string
  webVitalsVersion(): string
  performanceEnvironment(tab: Tab): BrowserPerformanceEnvironment
  performanceEnvironmentFingerprint(tab: Tab): string
  pageMetadata(tabId?: string): Promise<BrowserPageMetadataReport>
  inspectPwa(options?: BrowserPwaOptions): Promise<BrowserPwaReport>
  inspectorIssues(tabId?: string): Promise<BrowserInspectorIssuesReport>
}
