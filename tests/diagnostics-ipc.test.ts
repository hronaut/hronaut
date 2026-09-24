import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { expect, it, vi } from 'vitest'
import { registerDiagnosticsIpc } from '../src/main/diagnostics-ipc.js'

type Listener = Parameters<IpcMain['handle']>[1]
const channels = [
  'accessibility-audit', 'quality-audit', 'performance', 'design-overview',
  'page-metadata', 'security', 'code-coverage', 'cpu-profile', 'memory',
  'debug-report', 'set-diagnostic-log-preservation', 'repro-recording',
  'dom-changes', 'visual-compare', 'copy-visual-diff', 'inspector-issues'
]

function fixture() {
  const listeners = new Map<string, Listener>()
  const tabs = {
    accessibilityAudit: vi.fn(), qualityAudit: vi.fn(), performanceReport: vi.fn(),
    designOverview: vi.fn(), pageMetadata: vi.fn(), securityReport: vi.fn(),
    codeCoverage: vi.fn(), cpuProfile: vi.fn(), memoryReport: vi.fn(),
    debugReport: vi.fn(), setDiagnosticLogPreservation: vi.fn(), getState: vi.fn(),
    reproRecording: vi.fn(), domChanges: vi.fn(), visualCompare: vi.fn(),
    visualDiff: vi.fn(), inspectorIssues: vi.fn()
  }
  const host = {
    assertTrustedSender: vi.fn(), tabs: vi.fn(() => tabs),
    pngDataUrl: vi.fn(() => 'data:image/png;base64,diff'),
    copyPng: vi.fn(async () => ({ width: 20, height: 30 }))
  }
  registerDiagnosticsIpc({ handle: (channel, listener) => { listeners.set(channel, listener) } }, host)
  const event = {} as IpcMainInvokeEvent
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => listeners.get(`browser:${channel}`)!(event, ...args))
  return { listeners, host, tabs, event, invoke }
}

it('registers the complete diagnostic surface without resolving browser services', () => {
  const { listeners, host } = fixture()
  expect([...listeners.keys()]).toEqual(channels.map(channel => `browser:${channel}`))
  expect(host.tabs).not.toHaveBeenCalled()
})

it.each(channels)('rejects untrusted %s requests before accessing services or image helpers', async channel => {
  const { host, invoke, event } = fixture()
  host.assertTrustedSender.mockImplementation(() => { throw new Error('Untrusted sender') })
  await expect(invoke(channel, false)).rejects.toThrow('Untrusted sender')
  expect(host.assertTrustedSender).toHaveBeenCalledWith(event)
  expect(host.tabs).not.toHaveBeenCalled()
  expect(host.copyPng).not.toHaveBeenCalled()
  expect(host.pngDataUrl).not.toHaveBeenCalled()
})

it.each(channels)('rejects malformed %s arguments before accessing services', async channel => {
  const { host, invoke } = fixture()
  await expect(invoke(channel, false)).rejects.toThrow(TypeError)
  expect(host.tabs).not.toHaveBeenCalled()
})

it.each([
  ['accessibility-audit', 'accessibilityAudit', { tabId: 'tab', action: 'set-baseline', standard: 'wcag-aa' }],
  ['quality-audit', 'qualityAudit', 'tab'],
  ['performance', 'performanceReport', { tabId: 'tab', settleMs: 20 }],
  ['design-overview', 'designOverview', 'tab'],
  ['page-metadata', 'pageMetadata', 'tab'],
  ['security', 'securityReport', 'tab'],
  ['code-coverage', 'codeCoverage', { tabId: 'tab', action: 'start', mode: 'block', reload: true }],
  ['cpu-profile', 'cpuProfile', { tabId: 'tab', action: 'stop' }],
  ['memory', 'memoryReport', { tabId: 'tab', action: 'measure', collectGarbage: false }],
  ['debug-report', 'debugReport', { tabId: 'tab', maxConsoleMessages: 5 }]
] as const)('forwards %s options and service results unchanged', async (channel, method, input) => {
  const { tabs, invoke } = fixture()
  const result = { marker: 'service result' }
  tabs[method].mockResolvedValueOnce(result)
  await expect(invoke(channel, input)).resolves.toBe(result)
  expect(tabs[method]).toHaveBeenCalledWith(input)
  tabs[method].mockRejectedValueOnce(new Error('Diagnostic failed'))
  await expect(invoke(channel, input)).rejects.toThrow('Diagnostic failed')
})

it('routes recorder actions, issue clearing, and preservation state', async () => {
  const { tabs, invoke } = fixture()
  for (const action of ['start', 'get', 'stop', 'clear']) {
    await invoke('repro-recording', { tabId: 'tab', action })
    expect(tabs.reproRecording).toHaveBeenLastCalledWith(action, 'tab')
    await invoke('dom-changes', { action })
    expect(tabs.domChanges).toHaveBeenLastCalledWith(action, undefined)
  }
  await invoke('inspector-issues', { tabId: 'tab', clear: true })
  expect(tabs.inspectorIssues).toHaveBeenCalledWith('tab', true)
  tabs.getState.mockReturnValue({ marker: 'state' })
  await expect(invoke('set-diagnostic-log-preservation', 'tab', true)).resolves.toEqual({ marker: 'state' })
  expect(tabs.setDiagnosticLogPreservation).toHaveBeenCalledWith('tab', true)
  tabs.setDiagnosticLogPreservation.mockImplementationOnce(() => { throw new Error('Closed tab') })
  await expect(invoke('set-diagnostic-log-preservation', 'tab', false)).rejects.toThrow('Closed tab')
  expect(tabs.getState).toHaveBeenCalledOnce()
})

it('converts only existing visual diffs and awaits clipboard completion', async () => {
  const { tabs, host, invoke } = fixture()
  const report = { marker: 'report' }
  const png = Buffer.from('image bytes')
  tabs.visualCompare.mockResolvedValueOnce({ report }).mockResolvedValueOnce({ report, diffPng: png })
  await expect(invoke('visual-compare', { action: 'get' })).resolves.toEqual(report)
  expect(host.pngDataUrl).not.toHaveBeenCalled()
  await expect(invoke('visual-compare', { action: 'compare', tabId: 'tab' })).resolves.toEqual({ ...report, diffPngDataUrl: 'data:image/png;base64,diff' })
  expect(host.pngDataUrl).toHaveBeenCalledWith(png)
  tabs.visualDiff.mockReturnValue(png)
  await expect(invoke('copy-visual-diff', 'tab')).resolves.toEqual({ copied: true, width: 20, height: 30 })
  expect(tabs.visualDiff).toHaveBeenCalledWith('tab')
  expect(host.copyPng).toHaveBeenCalledWith(png)
  host.copyPng.mockRejectedValueOnce(new Error('Clipboard unavailable'))
  await expect(invoke('copy-visual-diff', 'tab')).rejects.toThrow('Clipboard unavailable')
})

it.each([
  ['accessibility-audit', { action: ['measure'] }],
  ['accessibility-audit', { standard: ['wcag-aa'] }],
  ['code-coverage', { action: ['start'] }],
  ['code-coverage', { mode: ['block'] }],
  ['cpu-profile', { action: ['stop'] }],
  ['memory', { action: ['measure'] }],
  ['repro-recording', { action: ['get'] }],
  ['dom-changes', { action: ['clear'] }],
  ['visual-compare', { action: ['compare'] }]
])('rejects array-valued enums in %s before touching browser state', async (channel, options) => {
  const { host, invoke } = fixture()
  await expect(invoke(channel as string, options)).rejects.toThrow(TypeError)
  expect(host.tabs).not.toHaveBeenCalled()
})
