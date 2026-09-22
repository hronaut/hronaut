import type { WebContents } from 'electron'
import {
  CODE_COVERAGE_LIMITS,
  coverageByteUsage,
  summarizeCoverageResources,
  type CoverageRange
} from '../../shared/code-coverage.js'
import { summarizeCpuProfile, type CdpCpuProfile } from '../../shared/cpu-profile.js'
import { summarizeAllocationProfile, type CdpSamplingHeapProfile } from '../../shared/allocation-profile.js'
import { redactNetworkUrl } from '../../shared/network-details.js'
import { isHronautHomeUrl, isWebUrl } from './url.js'
import type {
  BrowserCodeCoverageMode,
  BrowserCodeCoverageOptions,
  BrowserCodeCoverageReport,
  BrowserCodeCoverageResource,
  BrowserCodeCoverageResult,
  BrowserCpuProfileOptions,
  BrowserCpuProfileReport,
  BrowserCpuProfileResult,
  BrowserMemoryDelta,
  BrowserMemoryAllocationProfile,
  BrowserMemoryMeasurement,
  BrowserMemoryOptions,
  BrowserMemoryReport,
  BrowserEmulationState
} from '../../shared/types.js'

interface BrowserCodeCoverageStyleSheet {
  id: string
  url: string
  length: number
}

interface BrowserCodeCoverageInternal {
  recording?: {
    startedAt: string
    startedUrl: string
    mode: BrowserCodeCoverageMode
    styleSheets: Map<string, BrowserCodeCoverageStyleSheet>
  }
  report?: BrowserCodeCoverageReport
}

interface BrowserCpuProfileInternal {
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserCpuProfileReport
}

interface BrowserMemoryAllocationInternal {
  recording?: {
    startedAt: string
    startedUrl: string
  }
  report?: BrowserMemoryAllocationProfile
}

/** Profiling state belongs to the tab, so navigation and teardown remain authoritative. */
export interface BrowserProfilingState {
  memoryBaseline?: { url: string; measurement: BrowserMemoryMeasurement }
  memoryBaselineGeneration: number
  codeCoverage?: BrowserCodeCoverageInternal
  cpuProfile?: BrowserCpuProfileInternal
  memoryAllocation?: BrowserMemoryAllocationInternal
}

export interface BrowserProfilingTab extends BrowserProfilingState {
  id: string
  url: string
  title: string
  navigationGeneration: number
  webContents: WebContents
  emulation: Pick<BrowserEmulationState, 'renderingDebug'>
}

interface BrowserProfilingHost<Tab extends BrowserProfilingTab> {
  getTab(tabId?: string): Tab
  findTab(tabId: string): Tab | undefined
  withDebugger<T>(webContents: WebContents, operation: () => Promise<T>): Promise<T>
  changed(): void
  prepareNavigation(tab: Tab): void
}

/** Coordinates the mutually exclusive Chromium profilers through the manager's debugger lease. */
export class BrowserProfilingController<Tab extends BrowserProfilingTab> {
  constructor(private readonly host: BrowserProfilingHost<Tab>) {}

  handleDebuggerMessage(tab: Tab, method: string, params: unknown): void {
    if (method === 'CSS.styleSheetAdded') {
      const header = (params as {
        header?: { styleSheetId?: string; sourceURL?: string; length?: number }
      }).header
      const recording = tab.codeCoverage?.recording
      if (recording && header?.styleSheetId) {
        recording.styleSheets.set(header.styleSheetId, {
          id: header.styleSheetId,
          url: String(header.sourceURL ?? ''),
          length: Math.max(0, Math.round(header.length ?? 0))
        })
      }
    } else if (method === 'CSS.styleSheetRemoved') {
      const styleSheetId = (params as { styleSheetId?: string }).styleSheetId
      if (styleSheetId) tab.codeCoverage?.recording?.styleSheets.delete(styleSheetId)
    }
  }

  handleDebuggerDetached(tab: Tab): void {
    if (tab.codeCoverage?.recording) tab.codeCoverage = undefined
    if (tab.cpuProfile?.recording) tab.cpuProfile = undefined
    if (tab.memoryAllocation?.recording) tab.memoryAllocation = undefined
  }

  async codeCoverage(options: BrowserCodeCoverageOptions = {}): Promise<BrowserCodeCoverageResult> {
    const tab = this.host.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording code coverage')
    const action = options.action ?? 'get'
    if (!['get', 'start', 'stop', 'clear'].includes(action)) throw new Error('Unsupported code coverage action')

    if (action === 'get') return this.codeCoverageResult(tab, action)
    if (action === 'start') {
      if (tab.codeCoverage?.recording) throw new Error('Code coverage is already recording for this tab')
      if (tab.cpuProfile?.recording) throw new Error('Stop the JavaScript CPU profile before recording code coverage')
      if (tab.memoryAllocation?.recording) throw new Error('Stop memory allocation sampling before recording code coverage')
      const mode = options.mode ?? 'function'
      if (mode !== 'function' && mode !== 'block') throw new Error('Code coverage mode must be function or block')
      const recording: NonNullable<BrowserCodeCoverageInternal['recording']> = {
        startedAt: new Date().toISOString(),
        startedUrl: tab.url,
        mode,
        styleSheets: new Map()
      }
      tab.codeCoverage = { recording }
      try {
        await this.host.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('DOM.enable')
          await tab.webContents.debugger.sendCommand('CSS.enable')
          await tab.webContents.debugger.sendCommand('Debugger.enable')
          await tab.webContents.debugger.sendCommand('Profiler.enable')
          await tab.webContents.debugger.sendCommand('Profiler.startPreciseCoverage', {
            callCount: false,
            detailed: mode === 'block',
            allowTriggeredUpdates: false
          })
          await tab.webContents.debugger.sendCommand('CSS.startRuleUsageTracking')
        })
      } catch (error) {
        tab.codeCoverage = undefined
        throw error
      }
      this.host.changed()
      if (options.reload !== false) {
        this.host.prepareNavigation(tab)
        tab.webContents.reloadIgnoringCache()
      }
      return this.codeCoverageResult(tab, action)
    }

    if (action === 'clear') {
      const cleared = Boolean(tab.codeCoverage?.recording || tab.codeCoverage?.report)
      if (tab.codeCoverage?.recording) await this.discardCodeCoverageRecording(tab)
      tab.codeCoverage = undefined
      this.host.changed()
      return this.codeCoverageResult(tab, action, cleared)
    }

    const recording = tab.codeCoverage?.recording
    if (!recording) throw new Error('Start code coverage before stopping it')
    try {
      const report = await this.collectCodeCoverage(tab, recording)
      tab.codeCoverage = { report }
      this.host.changed()
      return this.codeCoverageResult(tab, action)
    } catch (error) {
      tab.codeCoverage = undefined
      this.host.changed()
      throw error
    }
  }

  private codeCoverageResult(
    tab: Tab,
    action: BrowserCodeCoverageResult['action'],
    cleared?: boolean
  ): BrowserCodeCoverageResult {
    const recording = tab.codeCoverage?.recording
    const report = tab.codeCoverage?.report
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      title: tab.title,
      action,
      status: recording ? 'recording' : report ? 'complete' : 'idle',
      ...(recording ? {
        recording: {
          startedAt: recording.startedAt,
          startedUrl: redactNetworkUrl(recording.startedUrl),
          mode: recording.mode
        }
      } : {}),
      ...(report ? { report } : {}),
      ...(cleared !== undefined ? { cleared } : {})
    }
  }

  private async collectCodeCoverage(
    tab: Tab,
    recording: NonNullable<BrowserCodeCoverageInternal['recording']>
  ): Promise<BrowserCodeCoverageReport> {
    return this.host.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      let truncated = false
      try {
        const [javascript, css] = await Promise.all([
          webDebugger.sendCommand('Profiler.takePreciseCoverage') as Promise<{
            result: Array<{
              scriptId: string
              url: string
              functions: Array<{ ranges: CoverageRange[] }>
            }>
          }>,
          webDebugger.sendCommand('CSS.stopRuleUsageTracking') as Promise<{
            ruleUsage: Array<{ styleSheetId: string; startOffset: number; endOffset: number; used: boolean }>
          }>
        ])

        const cssUsage = new Map<string, CoverageRange[]>()
        for (const usage of css.ruleUsage) {
          const ranges = cssUsage.get(usage.styleSheetId) ?? []
          ranges.push({ startOffset: usage.startOffset, endOffset: usage.endOffset, count: usage.used ? 1 : 0 })
          cssUsage.set(usage.styleSheetId, ranges)
        }
        const candidates: Array<{
          type: BrowserCodeCoverageResource['type']
          id: string
          url: string
          estimatedCharacters: number
          ranges: CoverageRange[]
        }> = []
        for (const script of javascript.result) {
          if (!isWebUrl(script.url)) continue
          const ranges = script.functions.flatMap((entry) => entry.ranges)
          const estimatedCharacters = ranges.reduce((maximum, range) => Math.max(maximum, range.endOffset), 0)
          if (!estimatedCharacters) continue
          candidates.push({ type: 'javascript', id: script.scriptId, url: script.url, estimatedCharacters, ranges })
        }
        for (const sheet of recording.styleSheets.values()) {
          if (!isWebUrl(sheet.url)) continue
          candidates.push({
            type: 'css',
            id: sheet.id,
            url: sheet.url,
            estimatedCharacters: sheet.length,
            ranges: cssUsage.get(sheet.id) ?? []
          })
        }
        candidates.sort((left, right) => right.estimatedCharacters - left.estimatedCharacters)
        if (candidates.length > CODE_COVERAGE_LIMITS.maxResources) truncated = true

        const rawResources: BrowserCodeCoverageResource[] = []
        for (const candidate of candidates.slice(0, CODE_COVERAGE_LIMITS.maxResources)) {
          if (candidate.estimatedCharacters > CODE_COVERAGE_LIMITS.maxSourceCharacters) {
            truncated = true
            continue
          }
          try {
            const source = candidate.type === 'javascript'
              ? ((await webDebugger.sendCommand('Debugger.getScriptSource', { scriptId: candidate.id })) as { scriptSource?: string }).scriptSource
              : ((await webDebugger.sendCommand('CSS.getStyleSheetText', { styleSheetId: candidate.id })) as { text?: string }).text
            if (typeof source !== 'string') {
              truncated = true
              continue
            }
            const usage = coverageByteUsage(source, candidate.ranges)
            const unusedBytes = Math.max(0, usage.totalBytes - usage.usedBytes)
            rawResources.push({
              url: redactNetworkUrl(candidate.url),
              type: candidate.type,
              totalBytes: usage.totalBytes,
              usedBytes: usage.usedBytes,
              unusedBytes,
              usedPercent: usage.totalBytes ? Math.round((usage.usedBytes / usage.totalBytes) * 10_000) / 100 : 0
            })
          } catch {
            truncated = true
          }
        }

        const grouped = new Map<string, BrowserCodeCoverageResource>()
        for (const resource of rawResources) {
          const key = `${resource.type}\u0000${resource.url}`
          const existing = grouped.get(key)
          if (!existing) {
            grouped.set(key, { ...resource })
            continue
          }
          existing.totalBytes += resource.totalBytes
          existing.usedBytes += resource.usedBytes
          existing.unusedBytes += resource.unusedBytes
          existing.usedPercent = existing.totalBytes
            ? Math.round((existing.usedBytes / existing.totalBytes) * 10_000) / 100
            : 0
        }
        const resources = [...grouped.values()]
          .sort((left, right) => right.unusedBytes - left.unusedBytes || right.totalBytes - left.totalBytes)
        const summary = summarizeCoverageResources(resources)
        return {
          startedAt: recording.startedAt,
          stoppedAt: new Date().toISOString(),
          startedUrl: redactNetworkUrl(recording.startedUrl),
          currentUrl: redactNetworkUrl(tab.url),
          mode: recording.mode,
          ...summary,
          resources,
          truncated,
          caveats: [
            'Coverage includes only code observed after recording started; exercise the relevant page paths before stopping.',
            'Function mode has lower overhead; block mode is more precise but can slow JavaScript execution.',
            'Unused bytes in one recording are optimization evidence, not proof that code is unused for every user or route.'
          ]
        }
      } finally {
        await webDebugger.sendCommand('Profiler.stopPreciseCoverage').catch(() => undefined)
        await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
        await webDebugger.sendCommand('CSS.disable').catch(() => undefined)
        if (!tab.emulation.renderingDebug || !Object.values(tab.emulation.renderingDebug).some(Boolean)) {
          await webDebugger.sendCommand('DOM.disable').catch(() => undefined)
        }
        await webDebugger.sendCommand('Debugger.disable').catch(() => undefined)
      }
    })
  }

  private async discardCodeCoverageRecording(tab: Tab): Promise<void> {
    await this.host.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('Profiler.stopPreciseCoverage').catch(() => undefined)
      await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
      await webDebugger.sendCommand('CSS.stopRuleUsageTracking').catch(() => undefined)
      await webDebugger.sendCommand('CSS.disable').catch(() => undefined)
      if (!tab.emulation.renderingDebug || !Object.values(tab.emulation.renderingDebug).some(Boolean)) {
        await webDebugger.sendCommand('DOM.disable').catch(() => undefined)
      }
      await webDebugger.sendCommand('Debugger.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  async cpuProfile(options: BrowserCpuProfileOptions = {}): Promise<BrowserCpuProfileResult> {
    const tab = this.host.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before recording a JavaScript CPU profile')
    const action = options.action ?? 'get'
    if (!['get', 'start', 'stop', 'clear'].includes(action)) throw new Error('Unsupported JavaScript CPU profile action')

    if (action === 'get') return this.cpuProfileResult(tab, action)
    if (action === 'start') {
      if (tab.cpuProfile?.recording) throw new Error('A JavaScript CPU profile is already recording for this tab')
      if (tab.codeCoverage?.recording) throw new Error('Stop code coverage before recording a JavaScript CPU profile')
      if (tab.memoryAllocation?.recording) throw new Error('Stop memory allocation sampling before recording a JavaScript CPU profile')
      tab.cpuProfile = {
        recording: {
          startedAt: new Date().toISOString(),
          startedUrl: tab.url
        }
      }
      try {
        await this.host.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('Profiler.enable')
          await tab.webContents.debugger.sendCommand('Profiler.setSamplingInterval', { interval: 1_000 })
          await tab.webContents.debugger.sendCommand('Profiler.start')
        })
      } catch (error) {
        tab.cpuProfile = undefined
        throw error
      }
      this.host.changed()
      return this.cpuProfileResult(tab, action)
    }

    if (action === 'clear') {
      const cleared = Boolean(tab.cpuProfile?.recording || tab.cpuProfile?.report)
      if (tab.cpuProfile?.recording) await this.discardCpuProfileRecording(tab)
      tab.cpuProfile = undefined
      this.host.changed()
      return this.cpuProfileResult(tab, action, cleared)
    }

    const recording = tab.cpuProfile?.recording
    if (!recording) throw new Error('Start a JavaScript CPU profile before stopping it')
    try {
      const response = await this.host.withDebugger(tab.webContents, async () => {
        try {
          return await tab.webContents.debugger.sendCommand('Profiler.stop') as { profile: CdpCpuProfile }
        } finally {
          await tab.webContents.debugger.sendCommand('Profiler.disable').catch(() => undefined)
        }
      })
      const summary = summarizeCpuProfile(response.profile, redactNetworkUrl)
      const report: BrowserCpuProfileReport = {
        startedAt: recording.startedAt,
        stoppedAt: new Date().toISOString(),
        startedUrl: redactNetworkUrl(recording.startedUrl),
        currentUrl: redactNetworkUrl(tab.url),
        ...summary,
        caveats: [
          'The profile contains sampled JavaScript self time, so short functions and browser rendering work may not appear.',
          'Record the smallest reproducible interaction and compare repeated runs before changing production code.',
          'Function names and sanitized locations are included, but source code, arguments, and page content are never returned.'
        ]
      }
      tab.cpuProfile = { report }
      this.host.changed()
      return this.cpuProfileResult(tab, action)
    } catch (error) {
      tab.cpuProfile = undefined
      this.host.changed()
      throw error
    }
  }

  private cpuProfileResult(
    tab: Tab,
    action: BrowserCpuProfileResult['action'],
    cleared?: boolean
  ): BrowserCpuProfileResult {
    const recording = tab.cpuProfile?.recording
    const report = tab.cpuProfile?.report
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      title: tab.title,
      action,
      status: recording ? 'recording' : report ? 'complete' : 'idle',
      ...(recording ? {
        recording: {
          startedAt: recording.startedAt,
          startedUrl: redactNetworkUrl(recording.startedUrl)
        }
      } : {}),
      ...(report ? { report } : {}),
      ...(cleared !== undefined ? { cleared } : {})
    }
  }

  private async discardCpuProfileRecording(tab: Tab): Promise<void> {
    await this.host.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('Profiler.stop').catch(() => undefined)
      await webDebugger.sendCommand('Profiler.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  async memoryReport(options: BrowserMemoryOptions = {}): Promise<BrowserMemoryReport> {
    const tab = this.host.getTab(options.tabId)
    if (isHronautHomeUrl(tab.url)) throw new Error('Open a website tab before measuring memory')
    const navigationGeneration = tab.navigationGeneration
    const action = options.action ?? 'measure'
    if (![
      'measure',
      'set-baseline',
      'clear-baseline',
      'start-allocation-sampling',
      'stop-allocation-sampling',
      'clear-allocation-sampling'
    ].includes(action)) throw new Error('Unsupported memory action')

    const baselineGeneration = action === 'set-baseline' || action === 'clear-baseline'
      ? ++tab.memoryBaselineGeneration
      : undefined
    if (tab.memoryBaseline && tab.memoryBaseline.url !== tab.url) tab.memoryBaseline = undefined
    if (action === 'clear-baseline') {
      const cleared = Boolean(tab.memoryBaseline)
      tab.memoryBaseline = undefined
      return this.memoryReportResult(tab, action, false, cleared)
    }

    if (action === 'start-allocation-sampling') {
      if (tab.memoryAllocation?.recording) throw new Error('Memory allocation sampling is already recording for this tab')
      if (tab.codeCoverage?.recording) throw new Error('Stop code coverage before recording memory allocations')
      if (tab.cpuProfile?.recording) throw new Error('Stop the JavaScript CPU profile before recording memory allocations')
      const current = await this.captureMemoryMeasurement(tab, options.collectGarbage === true)
      const recording: NonNullable<BrowserMemoryAllocationInternal['recording']> = {
        startedAt: new Date().toISOString(),
        startedUrl: tab.url
      }
      tab.memoryAllocation = { recording }
      try {
        await this.host.withDebugger(tab.webContents, async () => {
          await tab.webContents.debugger.sendCommand('HeapProfiler.enable')
          await tab.webContents.debugger.sendCommand('HeapProfiler.startSampling', {
            samplingInterval: 32_768,
            stackDepth: 64
          })
        })
      } catch (error) {
        tab.memoryAllocation = undefined
        throw error
      }
      this.host.changed()
      return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
    }

    if (action === 'clear-allocation-sampling') {
      const cleared = Boolean(tab.memoryAllocation?.recording || tab.memoryAllocation?.report)
      if (tab.memoryAllocation?.recording) await this.discardMemoryAllocationRecording(tab)
      tab.memoryAllocation = undefined
      this.host.changed()
      return this.memoryReportResult(tab, action, false, cleared)
    }

    if (action === 'stop-allocation-sampling') {
      const recording = tab.memoryAllocation?.recording
      if (!recording) throw new Error('Start memory allocation sampling before stopping it')
      try {
        const response = await this.host.withDebugger(tab.webContents, async () => {
          try {
            return await tab.webContents.debugger.sendCommand('HeapProfiler.stopSampling') as { profile: CdpSamplingHeapProfile }
          } finally {
            await tab.webContents.debugger.sendCommand('HeapProfiler.disable').catch(() => undefined)
          }
        })
        const summary = summarizeAllocationProfile(response.profile, redactNetworkUrl)
        tab.memoryAllocation = {
          report: {
            startedAt: recording.startedAt,
            stoppedAt: new Date().toISOString(),
            startedUrl: redactNetworkUrl(recording.startedUrl),
            currentUrl: redactNetworkUrl(tab.url),
            ...summary,
            caveats: [
              'Allocation sampling has low overhead but is statistical, so small or short-lived allocations may not appear.',
              'By default Chromium reports sampled objects still alive when recording stops; repeat the same interaction to confirm a retention pattern.',
              'Function names and sanitized locations are included, but object contents, values, source code, and page content are never returned.'
            ]
          }
        }
        const current = await this.captureMemoryMeasurement(tab, false)
        this.host.changed()
        return this.memoryReportResult(tab, action, false, false, current)
      } catch (error) {
        tab.memoryAllocation = undefined
        this.host.changed()
        throw error
      }
    }

    const current = await this.captureMemoryMeasurement(tab, options.collectGarbage === true)
    const currentTab = this.host.findTab(tab.id)
    if (
      !currentTab
      || currentTab !== tab
      || currentTab.webContents.isDestroyed()
      || currentTab.navigationGeneration !== navigationGeneration
    ) {
      throw new Error('The page changed during the memory measurement. Run a fresh measurement.')
    }
    if (
      baselineGeneration !== undefined
      && tab.memoryBaselineGeneration !== baselineGeneration
    ) {
      throw new Error('Memory baseline changed while the measurement was pending. Run the requested action again.')
    }
    if (action === 'set-baseline') {
      tab.memoryBaseline = { url: tab.url, measurement: current }
      return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
    }
    return this.memoryReportResult(tab, action, options.collectGarbage === true, false, current)
  }

  private memoryReportResult(
    tab: Tab,
    action: BrowserMemoryReport['action'],
    forcedGarbageCollection: boolean,
    cleared: boolean,
    current?: BrowserMemoryMeasurement
  ): BrowserMemoryReport {
    const baseline = tab.memoryBaseline?.url === tab.url ? tab.memoryBaseline.measurement : undefined
    const allocationRecording = tab.memoryAllocation?.recording
    const allocationProfile = tab.memoryAllocation?.report
    return {
      tabId: tab.id,
      url: redactNetworkUrl(tab.url),
      title: tab.title,
      action,
      forcedGarbageCollection,
      cleared,
      ...(baseline ? { baseline } : {}),
      ...(current ? { current } : {}),
      ...(baseline && current ? { delta: this.memoryDelta(baseline, current) } : {}),
      allocationStatus: allocationRecording ? 'recording' : allocationProfile ? 'complete' : 'idle',
      ...(allocationRecording ? {
        allocationRecording: {
          startedAt: allocationRecording.startedAt,
          startedUrl: redactNetworkUrl(allocationRecording.startedUrl)
        }
      } : {}),
      ...(allocationProfile ? { allocationProfile } : {}),
      caveats: [
        'This is one process-local sample; growth alone does not prove a memory leak.',
        'Compare repeated post-GC measurements after the same interaction for stronger evidence.',
        'A full navigation clears the baseline because it creates a different document.'
      ]
    }
  }

  private async discardMemoryAllocationRecording(tab: Tab): Promise<void> {
    await this.host.withDebugger(tab.webContents, async () => {
      const webDebugger = tab.webContents.debugger
      await webDebugger.sendCommand('HeapProfiler.stopSampling').catch(() => undefined)
      await webDebugger.sendCommand('HeapProfiler.disable').catch(() => undefined)
    }).catch(() => undefined)
  }

  private async captureMemoryMeasurement(tab: Tab, collectGarbage: boolean): Promise<BrowserMemoryMeasurement> {
    return this.host.withDebugger(tab.webContents, async () => {
      if (collectGarbage) await tab.webContents.debugger.sendCommand('HeapProfiler.collectGarbage')
      await tab.webContents.debugger.sendCommand('Performance.enable', { timeDomain: 'timeTicks' })
      const [heap, performance] = await Promise.all([
        tab.webContents.debugger.sendCommand('Runtime.getHeapUsage') as Promise<{
          usedSize: number
          totalSize: number
          embedderHeapUsedSize: number
          backingStorageSize: number
        }>,
        tab.webContents.debugger.sendCommand('Performance.getMetrics') as Promise<{
          metrics: Array<{ name: string; value: number }>
        }>
      ])
      const metrics = new Map(performance.metrics.map(({ name, value }) => [name, value]))
      const count = (name: string): number => Math.max(0, Math.round(metrics.get(name) ?? 0))
      return {
        capturedAt: new Date().toISOString(),
        jsHeapUsedBytes: Math.max(0, Math.round(heap.usedSize)),
        jsHeapTotalBytes: Math.max(0, Math.round(heap.totalSize)),
        embedderHeapUsedBytes: Math.max(0, Math.round(heap.embedderHeapUsedSize)),
        backingStorageBytes: Math.max(0, Math.round(heap.backingStorageSize)),
        documents: count('Documents'),
        frames: count('Frames'),
        nodes: count('Nodes'),
        eventListeners: count('JSEventListeners'),
        layoutObjects: count('LayoutObjects')
      }
    })
  }

  private memoryDelta(baseline: BrowserMemoryMeasurement, current: BrowserMemoryMeasurement): BrowserMemoryDelta {
    return {
      jsHeapUsedBytes: current.jsHeapUsedBytes - baseline.jsHeapUsedBytes,
      jsHeapTotalBytes: current.jsHeapTotalBytes - baseline.jsHeapTotalBytes,
      embedderHeapUsedBytes: current.embedderHeapUsedBytes - baseline.embedderHeapUsedBytes,
      backingStorageBytes: current.backingStorageBytes - baseline.backingStorageBytes,
      documents: current.documents - baseline.documents,
      frames: current.frames - baseline.frames,
      nodes: current.nodes - baseline.nodes,
      eventListeners: current.eventListeners - baseline.eventListeners,
      layoutObjects: current.layoutObjects - baseline.layoutObjects
    }
  }

}
