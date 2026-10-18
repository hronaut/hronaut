export type BrowserCodeCoverageMode = 'function' | 'block'
export type BrowserCodeCoverageAction = 'get' | 'start' | 'stop' | 'clear'
export type BrowserCodeCoverageStatus = 'idle' | 'recording' | 'complete'

export interface BrowserCodeCoverageResource {
  url: string
  type: 'javascript' | 'css'
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
}

export interface BrowserCodeCoverageReport {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  mode: BrowserCodeCoverageMode
  totalBytes: number
  usedBytes: number
  unusedBytes: number
  usedPercent: number
  javascript: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
  css: { resourceCount: number; totalBytes: number; usedBytes: number; unusedBytes: number }
  resources: BrowserCodeCoverageResource[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserCodeCoverageResult {
  tabId: string
  url: string
  title: string
  action: BrowserCodeCoverageAction
  status: BrowserCodeCoverageStatus
  recording?: {
    startedAt: string
    startedUrl: string
    mode: BrowserCodeCoverageMode
  }
  report?: BrowserCodeCoverageReport
  cleared?: boolean
}

export interface BrowserCodeCoverageOptions {
  tabId?: string
  action?: BrowserCodeCoverageAction
  mode?: BrowserCodeCoverageMode
  reload?: boolean
}

export type BrowserCpuProfileAction = 'get' | 'start' | 'stop' | 'clear'
export type BrowserCpuProfileStatus = 'idle' | 'recording' | 'complete'

export interface BrowserCpuProfileHotspot {
  functionName: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  selfTimeMs: number
  selfPercent: number
  samples: number
}

export interface BrowserCpuProfileReport {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  durationMs: number
  sampledTimeMs: number
  sampleCount: number
  hotspots: BrowserCpuProfileHotspot[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserCpuProfileResult {
  tabId: string
  url: string
  title: string
  action: BrowserCpuProfileAction
  status: BrowserCpuProfileStatus
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserCpuProfileReport
  cleared?: boolean
}

export interface BrowserCpuProfileOptions {
  tabId?: string
  action?: BrowserCpuProfileAction
}

export type BrowserMemoryAction =
  | 'measure'
  | 'set-baseline'
  | 'clear-baseline'
  | 'start-allocation-sampling'
  | 'stop-allocation-sampling'
  | 'clear-allocation-sampling'

export type BrowserMemoryAllocationStatus = 'idle' | 'recording' | 'complete'

export interface BrowserMemoryAllocationHotspot {
  functionName: string
  url?: string
  lineNumber?: number
  columnNumber?: number
  selfBytes: number
  selfPercent: number
  samples: number
}

export interface BrowserMemoryAllocationProfile {
  startedAt: string
  stoppedAt: string
  startedUrl: string
  currentUrl: string
  sampledBytes: number
  sampleCount: number
  hotspots: BrowserMemoryAllocationHotspot[]
  truncated: boolean
  caveats: string[]
}

export interface BrowserMemoryMeasurement {
  capturedAt: string
  jsHeapUsedBytes: number
  jsHeapTotalBytes: number
  embedderHeapUsedBytes: number
  backingStorageBytes: number
  documents: number
  frames: number
  nodes: number
  eventListeners: number
  layoutObjects: number
}

export type BrowserMemoryDelta = Omit<BrowserMemoryMeasurement, 'capturedAt'>

export interface BrowserMemoryReport {
  tabId: string
  url: string
  title: string
  action: BrowserMemoryAction
  forcedGarbageCollection: boolean
  cleared: boolean
  baseline?: BrowserMemoryMeasurement
  current?: BrowserMemoryMeasurement
  delta?: BrowserMemoryDelta
  allocationStatus: BrowserMemoryAllocationStatus
  allocationRecording?: {
    startedAt: string
    startedUrl: string
  }
  allocationProfile?: BrowserMemoryAllocationProfile
  caveats: string[]
}

export interface BrowserMemoryOptions {
  tabId?: string
  action?: BrowserMemoryAction
  collectGarbage?: boolean
}
