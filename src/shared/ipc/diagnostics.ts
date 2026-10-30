import type { BrowserReproCheckpointInput } from '../repro-checkpoint.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../video.js'
import type {
  BrowserAccessibilityAudit,
  BrowserAccessibilityAuditOptions,
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileResult,
  BrowserDebugReport,
  BrowserDebugReportOptions,
  BrowserDesignOverviewReport,
  BrowserDomChangesAction,
  BrowserDomChangesReport,
  BrowserInspectorIssuesReport,
  BrowserMemoryOptions,
  BrowserMemoryReport,
  BrowserPageMetadataReport,
  BrowserPerformanceOptions,
  BrowserPerformanceReport,
  BrowserQualityAudit,
  BrowserReproAction,
  BrowserReproRecording,
  BrowserSecurityReport,
  BrowserState,
  BrowserVisualCompareOptions,
  BrowserVisualCompareView
} from '../types.js'
import type { InvokeChannel } from './channel.js'

/** What the shell's diagnostics panels ask main about a tab: audits, profiles, recordings and visual comparisons. A tab named by no id is the active one. */
export const DIAGNOSTICS_IPC = {
  /** Shell → main: measures the page's accessibility, or sets or clears the baseline later measurements compare with. */
  accessibilityAudit: 'browser:accessibility-audit' as InvokeChannel<[options: BrowserAccessibilityAuditOptions], BrowserAccessibilityAudit>,
  /** Shell → main: the page's quality findings. */
  qualityAudit: 'browser:quality-audit' as InvokeChannel<[tabId?: string], BrowserQualityAudit>,
  /**
   * Shell → main: measures the page's load and runtime performance after it settles, or sets or clears the baseline
   * later measurements compare with.
   */
  performance: 'browser:performance' as InvokeChannel<[options: BrowserPerformanceOptions], BrowserPerformanceReport>,
  /** Shell → main: the page's colors, fonts, media queries and contrast problems. */
  designOverview: 'browser:design-overview' as InvokeChannel<[tabId?: string], BrowserDesignOverviewReport>,
  /** Shell → main: the page's document metadata, social cards and structured data. */
  pageMetadata: 'browser:page-metadata' as InvokeChannel<[tabId?: string], BrowserPageMetadataReport>,
  /** Shell → main: whether the page's connection is secure, and its certificate. */
  security: 'browser:security' as InvokeChannel<[tabId?: string], BrowserSecurityReport>,
  /** Shell → main: starts, reads, stops or clears the page's JavaScript and CSS coverage. */
  codeCoverage: 'browser:code-coverage' as InvokeChannel<[options: BrowserCodeCoverageOptions], BrowserCodeCoverageResult>,
  /** Shell → main: starts, reads, stops or clears the page's JavaScript CPU profile. */
  cpuProfile: 'browser:cpu-profile' as InvokeChannel<[options: BrowserCpuProfileOptions], BrowserCpuProfileResult>,
  /** Shell → main: measures the page's memory, or manages its baseline and allocation sampling. */
  memory: 'browser:memory' as InvokeChannel<[options: BrowserMemoryOptions], BrowserMemoryReport>,
  /** Shell → main: one report of the page's console, network requests, problem and emulation, for a bug report. */
  debugReport: 'browser:debug-report' as InvokeChannel<[options: BrowserDebugReportOptions], BrowserDebugReport>,
  /** Shell → main: whether the tab keeps its console and network logs across navigations; answers the browser state. */
  setDiagnosticLogPreservation: 'browser:set-diagnostic-log-preservation' as InvokeChannel<[tabId: string, preserve: boolean], BrowserState>,
  /**
   * Shell → main: starts, pauses, resumes, stops, reads, edits, renders, exports or clears the tab's video recording,
   * or adds or removes its audio.
   */
  video: 'browser:video' as InvokeChannel<[options: BrowserVideoOptions], BrowserVideoState>,
  /** Shell → main: the recording's rendered video, for the shell to play. */
  videoPreview: 'browser:video-preview' as InvokeChannel<[tabId: string], Uint8Array>,
  /**
   * Shell → main: lets the person pick an audio file for the stopped recording, with where it came from and the right
   * to use it; answers the recording unchanged when no file is picked.
   */
  importVideoAudio: 'browser:video-import-audio' as InvokeChannel<[tabId: string, provenance: string], BrowserVideoState>,
  /** Shell → main: starts, reads, stops or clears the recording of the person's steps, or adds a checkpoint to it. */
  reproRecording: 'browser:repro-recording' as InvokeChannel<[options: { action: BrowserReproAction; tabId: string | undefined; checkpoint?: BrowserReproCheckpointInput }], BrowserReproRecording>,
  /** Shell → main: starts, reads, stops or clears the recording of the page's DOM changes. */
  domChanges: 'browser:dom-changes' as InvokeChannel<[options: { action: BrowserDomChangesAction; tabId: string | undefined }], BrowserDomChangesReport>,
  /**
   * Shell → main: sets, compares with, reads or clears the page's baseline picture; a comparison and later reads of it
   * come with its difference picture.
   */
  visualCompare: 'browser:visual-compare' as InvokeChannel<[options: BrowserVisualCompareOptions], BrowserVisualCompareView>,
  /** Shell → main: copies the last comparison's difference picture. */
  copyVisualDiff: 'browser:copy-visual-diff' as InvokeChannel<[tabId?: string], { copied: true; width: number; height: number }>,
  /**
   * Shell → main: the page's inspector issues and the HTTP Basic sign-in requests it made. Asked to clear them, main
   * clears them first, so the answer holds none and says how many issues were cleared.
   */
  inspectorIssues: 'browser:inspector-issues' as InvokeChannel<[options: { tabId: string | undefined; clear: boolean }], BrowserInspectorIssuesReport>
} as const
