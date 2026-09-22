import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { BrowserProfilingController, type BrowserProfilingTab } from '../src/main/browser/profiling-controller.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function fixture() {
  const sendCommand = vi.fn(async (method: string): Promise<unknown> => {
    if (method === 'Runtime.getHeapUsage') {
      return { usedSize: 100, totalSize: 200, embedderHeapUsedSize: 30, backingStorageSize: 40 }
    }
    if (method === 'Performance.getMetrics') {
      return { metrics: [{ name: 'Nodes', value: 10 }, { name: 'Documents', value: 1 }] }
    }
    return {}
  })
  const isDestroyed = vi.fn(() => false)
  const reloadIgnoringCache = vi.fn()
  const tab: BrowserProfilingTab = {
    id: 'tab-1',
    url: 'https://example.test/?token=private-value',
    title: 'Profiling fixture',
    navigationGeneration: 1,
    memoryBaselineGeneration: 0,
    emulation: {},
    webContents: { debugger: { sendCommand }, isDestroyed, reloadIgnoringCache } as unknown as WebContents
  }
  const tabs = new Map([[tab.id, tab]])
  const getTab = vi.fn((id = tab.id) => {
    const current = tabs.get(id)
    if (!current) throw new Error('Tab not found')
    return current
  })
  const changed = vi.fn()
  const prepareNavigation = vi.fn()
  const withDebugger = vi.fn<(contents: WebContents) => Promise<void>>(async () => undefined)
  const controller = new BrowserProfilingController({
    getTab, findTab: (id) => tabs.get(id), changed, prepareNavigation,
    withDebugger: async (contents, operation) => {
      await withDebugger(contents)
      return operation()
    }
  })
  return { controller, tab, tabs, getTab, sendCommand, isDestroyed, reloadIgnoringCache, changed, prepareNavigation, withDebugger }
}

describe('browser profiling controller', () => {
  it('uses authoritative tab lookup and the existing debugger lease before preparing a coverage reload', async () => {
    const f = fixture()
    const result = await f.controller.codeCoverage({ tabId: f.tab.id, action: 'start', mode: 'block' })
    expect(f.getTab).toHaveBeenCalledWith(f.tab.id)
    expect(f.withDebugger).toHaveBeenCalledWith(f.tab.webContents)
    expect(f.sendCommand).toHaveBeenCalledWith('Profiler.startPreciseCoverage', {
      callCount: false, detailed: true, allowTriggeredUpdates: false
    })
    expect(f.prepareNavigation).toHaveBeenCalledWith(f.tab)
    expect(f.reloadIgnoringCache).toHaveBeenCalledOnce()
    expect(f.prepareNavigation.mock.invocationCallOrder[0]).toBeLessThan(f.reloadIgnoringCache.mock.invocationCallOrder[0]!)
    expect(result).toMatchObject({ status: 'recording', recording: { mode: 'block' } })
    expect(JSON.stringify(result)).not.toContain('private-value')
  })

  it('keeps coverage, CPU profiling and allocation sampling mutually exclusive', async () => {
    const f = fixture()
    await f.controller.codeCoverage({ action: 'start', reload: false })
    await expect(f.controller.cpuProfile({ action: 'start' })).rejects.toThrow('Stop code coverage')
    await expect(f.controller.memoryReport({ action: 'start-allocation-sampling' })).rejects.toThrow('Stop code coverage')
    await f.controller.codeCoverage({ action: 'clear' })
    await f.controller.cpuProfile({ action: 'start' })
    await expect(f.controller.codeCoverage({ action: 'start' })).rejects.toThrow('Stop the JavaScript CPU profile')
    await expect(f.controller.memoryReport({ action: 'start-allocation-sampling' })).rejects.toThrow('Stop the JavaScript CPU profile')
    await f.controller.cpuProfile({ action: 'clear' })
    await f.controller.memoryReport({ action: 'start-allocation-sampling' })
    await expect(f.controller.codeCoverage({ action: 'start' })).rejects.toThrow('Stop memory allocation sampling')
    await expect(f.controller.cpuProfile({ action: 'start' })).rejects.toThrow('Stop memory allocation sampling')
  })

  it('clears a failed recording when the debugger lease rejects', async () => {
    const f = fixture()
    f.withDebugger.mockRejectedValueOnce(new Error('Close Developer Tools'))
    await expect(f.controller.cpuProfile({ action: 'start' })).rejects.toThrow('Close Developer Tools')
    expect(f.tab.cpuProfile).toBeUndefined()
    expect(f.sendCommand).not.toHaveBeenCalled()
    expect(await f.controller.cpuProfile()).toMatchObject({ status: 'idle' })
  })

  it('collects bounded coverage with private URLs redacted and keeps rendering overlays enabled', async () => {
    const f = fixture()
    f.tab.emulation.renderingDebug = {
      paintFlashing: true, layoutShiftRegions: false, layerBorders: false, fpsCounter: false, scrollBottlenecks: false
    }
    await f.controller.codeCoverage({ action: 'start', reload: false })
    f.controller.handleDebuggerMessage(f.tab, 'CSS.styleSheetAdded', {
      header: { styleSheetId: 'style', sourceURL: 'https://example.test/app.css?token=css-secret', length: 4 }
    })
    f.controller.handleDebuggerMessage(f.tab, 'CSS.styleSheetAdded', {
      header: { styleSheetId: 'removed', sourceURL: 'https://example.test/removed.css', length: 4 }
    })
    f.controller.handleDebuggerMessage(f.tab, 'CSS.styleSheetRemoved', { styleSheetId: 'removed' })
    f.sendCommand.mockImplementation(async (method) => {
      if (method === 'Profiler.takePreciseCoverage') return { result: [{
        scriptId: 'script', url: 'https://example.test/app.js?token=script-secret',
        functions: [{ ranges: [{ startOffset: 0, endOffset: 4, count: 1 }] }]
      }] }
      if (method === 'CSS.stopRuleUsageTracking') {
        return { ruleUsage: [{ styleSheetId: 'style', startOffset: 0, endOffset: 2, used: true }] }
      }
      if (method === 'Debugger.getScriptSource') return { scriptSource: 'code' }
      if (method === 'CSS.getStyleSheetText') return { text: 'body' }
      return {}
    })
    const result = await f.controller.codeCoverage({ action: 'stop' })
    expect(result).toMatchObject({ status: 'complete', report: { truncated: false, resources: [
      { type: 'css', totalBytes: 4, usedBytes: 2, unusedBytes: 2 },
      { type: 'javascript', totalBytes: 4, usedBytes: 4, unusedBytes: 0 }
    ] } })
    expect(JSON.stringify(result)).not.toMatch(/private-value|css-secret|script-secret|removed\.css/)
    expect(f.sendCommand).toHaveBeenCalledWith('Profiler.stopPreciseCoverage')
    expect(f.sendCommand).toHaveBeenCalledWith('CSS.disable')
    expect(f.sendCommand).not.toHaveBeenCalledWith('DOM.disable')
  })

  it('invalidates active recordings on debugger detachment without clearing the memory baseline', async () => {
    const f = fixture()
    await f.controller.cpuProfile({ action: 'start' })
    f.controller.handleDebuggerDetached(f.tab)
    expect(await f.controller.cpuProfile()).toMatchObject({ status: 'idle' })
    await f.controller.memoryReport({ action: 'start-allocation-sampling' })
    f.controller.handleDebuggerDetached(f.tab)
    expect(f.tab.memoryAllocation).toBeUndefined()
    await f.controller.codeCoverage({ action: 'start', reload: false })
    f.controller.handleDebuggerDetached(f.tab)
    expect(f.tab.codeCoverage).toBeUndefined()
    await f.controller.memoryReport({ action: 'set-baseline' })
    const baseline = f.tab.memoryBaseline
    f.controller.handleDebuggerDetached(f.tab)
    expect(f.tab.memoryBaseline).toBe(baseline)
  })

  it.each(['navigation', 'closed', 'replaced', 'destroyed'] as const)(
    'rejects a memory measurement after the tab is %s', async (change) => {
      const f = fixture()
      const pending = deferred<unknown>()
      f.sendCommand.mockImplementationOnce(() => pending.promise)
      const measurement = f.controller.memoryReport({ action: 'set-baseline' })
      if (change === 'navigation') f.tab.navigationGeneration += 1
      if (change === 'closed') f.tabs.delete(f.tab.id)
      if (change === 'replaced') f.tabs.set(f.tab.id, { ...f.tab })
      if (change === 'destroyed') f.isDestroyed.mockReturnValue(true)
      pending.resolve({})
      await expect(measurement).rejects.toThrow('The page changed during the memory measurement')
      expect(f.tab.memoryBaseline).toBeUndefined()
    }
  )

  it('does not restore a baseline after a newer clear or replace action', async () => {
    const f = fixture()
    const pending = deferred<unknown>()
    f.sendCommand.mockImplementationOnce(() => pending.promise)
    const older = f.controller.memoryReport({ action: 'set-baseline' })
    await f.controller.memoryReport({ action: 'clear-baseline' })
    const newer = await f.controller.memoryReport({ action: 'set-baseline' })
    pending.resolve({})
    await expect(older).rejects.toThrow('Memory baseline changed')
    expect(f.tab.memoryBaseline?.measurement).toEqual(newer.current)
  })

  it('reports memory deltas without changing the saved baseline', async () => {
    const f = fixture()
    const baseline = await f.controller.memoryReport({ action: 'set-baseline' })
    const original = f.sendCommand.getMockImplementation()!
    f.sendCommand.mockImplementation(async (method) => method === 'Runtime.getHeapUsage'
      ? { usedSize: 150, totalSize: 200, embedderHeapUsedSize: 30, backingStorageSize: 40 }
      : original(method))
    const result = await f.controller.memoryReport()
    expect(result.baseline).toEqual(baseline.current)
    expect(result.delta).toMatchObject({ jsHeapUsedBytes: 50, jsHeapTotalBytes: 0, nodes: 0 })
  })
})
