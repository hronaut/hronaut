import { DIAGNOSTICS_IPC } from '../../shared/ipc/diagnostics.js'
import type {
  HronautDebugReportApi,
  HronautPageAuditsApi,
  HronautProfilingApi,
  HronautRecordingApi,
  HronautVisualCompareApi
} from '../../shared/types.js'
import { invoke } from './ipc.js'

/** window.hronaut's accessibility, quality, performance, design, metadata and security reports of a tab. */
export const pageAuditsApi: HronautPageAuditsApi = {
  runAccessibilityAudit: (options = {}) => invoke(DIAGNOSTICS_IPC.accessibilityAudit, options),
  runQualityAudit: (tabId) => invoke(DIAGNOSTICS_IPC.qualityAudit, tabId),
  measurePerformance: (options = {}) => invoke(DIAGNOSTICS_IPC.performance, options),
  inspectDesign: (tabId) => invoke(DIAGNOSTICS_IPC.designOverview, tabId),
  inspectPageMetadata: (tabId) => invoke(DIAGNOSTICS_IPC.pageMetadata, tabId),
  inspectSecurity: (tabId) => invoke(DIAGNOSTICS_IPC.security, tabId)
}

/** window.hronaut's code coverage, JavaScript CPU profile and memory of a tab. */
export const profilingApi: HronautProfilingApi = {
  manageCodeCoverage: (options = {}) => invoke(DIAGNOSTICS_IPC.codeCoverage, options),
  manageCpuProfile: (options = {}) => invoke(DIAGNOSTICS_IPC.cpuProfile, options),
  measureMemory: (options = {}) => invoke(DIAGNOSTICS_IPC.memory, options)
}

/** window.hronaut's debug report, kept diagnostic logs and inspector issues of a tab. */
export const debugReportApi: HronautDebugReportApi = {
  createDebugReport: (options = {}) => invoke(DIAGNOSTICS_IPC.debugReport, options),
  setDiagnosticLogPreservation: (tabId, preserve) => invoke(DIAGNOSTICS_IPC.setDiagnosticLogPreservation, tabId, preserve),
  listInspectorIssues: (tabId, clear = false) => invoke(DIAGNOSTICS_IPC.inspectorIssues, { tabId, clear })
}

/** window.hronaut's recordings of a tab: its video, the person's steps and its DOM changes. */
export const recordingApi: HronautRecordingApi = {
  manageVideo: (options) => invoke(DIAGNOSTICS_IPC.video, options),
  importVideoAudio: (tabId, provenance) => invoke(DIAGNOSTICS_IPC.importVideoAudio, tabId, provenance),
  videoPreview: (tabId) => invoke(DIAGNOSTICS_IPC.videoPreview, tabId),
  manageRepro: (action, tabId, checkpoint) =>
    invoke(DIAGNOSTICS_IPC.reproRecording, { action, tabId, ...(checkpoint ? { checkpoint } : {}) }),
  manageDomChanges: (action, tabId) => invoke(DIAGNOSTICS_IPC.domChanges, { action, tabId })
}

/** window.hronaut's comparison of a tab's page with its baseline picture. */
export const visualCompareApi: HronautVisualCompareApi = {
  visualCompare: (options) => invoke(DIAGNOSTICS_IPC.visualCompare, options),
  copyVisualDiff: (tabId) => invoke(DIAGNOSTICS_IPC.copyVisualDiff, tabId)
}
