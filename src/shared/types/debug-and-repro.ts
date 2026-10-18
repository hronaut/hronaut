import type { BrowserReproExpectation } from '../repro-checkpoint.js'
import type { BrowserPageProblem } from './page-problems.js'
import type { BrowserEmulationState, BrowserUnconfirmedEmulation } from './emulation.js'
import type { BrowserConsoleMessage, BrowserNetworkRequest } from './console-network.js'

export interface BrowserDebugReportOptions {
  tabId?: string
  maxConsoleMessages?: number
  maxNetworkRequests?: number
  includeSuccessfulRequests?: boolean
}

export interface BrowserDiagnosticLogState {
  tabId: string
  url: string
  preserveAcrossNavigation: boolean
  consoleMessageCount: number
  networkRequestCount: number
}

export interface BrowserDebugNetworkRequest extends BrowserNetworkRequest {
  durationMs?: number
  issue: boolean
}

export interface BrowserDebugReport {
  generatedAt: string
  tabId: string
  title: string
  url: string
  pageProblem?: BrowserPageProblem
  emulation?: BrowserEmulationState
  emulationState?: BrowserUnconfirmedEmulation
  networkRouteCount: number
  summary: {
    consoleMessages: number
    consoleWarnings: number
    consoleErrors: number
    networkRequests: number
    failedRequests: number
    pendingRequests: number
    cachedRequests: number
    responseBytes: number
  }
  console: BrowserConsoleMessage[]
  network: BrowserDebugNetworkRequest[]
  truncated: {
    console: boolean
    network: boolean
  }
  caveats: string[]
}

export type BrowserReproAction = 'start' | 'get' | 'stop' | 'clear' | 'checkpoint'
export type BrowserReproStepKind = 'navigate' | 'click' | 'input' | 'key' | 'scroll' | 'expect'

export interface BrowserReproTarget {
  /** Empty when no bounded, unique top-level light-DOM selector represents the target; export as a manual step. */
  selector: string
  tag: string
  role?: string
  label?: string
  inputType?: string
}

export interface BrowserReproStep {
  index: number
  kind: BrowserReproStepKind
  occurredAt: string
  elapsedMs: number
  description: string
  url: string
  target?: BrowserReproTarget
  key?: string
  scroll?: { x: number; y: number }
  valueRedacted?: boolean
  expectation?: BrowserReproExpectation
}

export interface BrowserReproRecording {
  formatVersion?: 2 | 3 | 4
  checkpointContext?: string
  tabId: string
  title: string
  startedAt?: string
  stoppedAt?: string
  active: boolean
  stepCount: number
  steps: BrowserReproStep[]
  truncated: boolean
  caveats: string[]
}
