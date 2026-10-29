import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
// The browser below stubs changed, setEmulationViewSize, invalidateTabOverviewPreview and
// cancelNativeSelectionSessions, which a page process exit runs through; its console keeps plain text.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))
vi.mock('../src/main/browser/emulation/emulation-view-size.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/emulation/emulation-view-size.js')>(),
  setEmulationViewSize: (browser: { setEmulationViewSize: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.setEmulationViewSize(...args)
}))
vi.mock('../src/main/browser/tab-overview-previews/tab-overview-previews.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/tab-overview-previews/tab-overview-previews.js')>(),
  invalidateTabOverviewPreview: (browser: { invalidateTabOverviewPreview: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.invalidateTabOverviewPreview(...args)
}))
vi.mock('../src/main/browser/native-selections/native-selections.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/native-selections/native-selections.js')>(),
  cancelNativeSelectionSessions: (browser: { cancelNativeSelectionSessions: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.cancelNativeSelectionSessions(...args)
}))
vi.mock('../src/main/browser/console-messages/console-messages.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/console-messages/console-messages.js')>(),
  appendConsoleMessage: (target: { consoleMessages: string[] }, message: { message: string }) => { target.consoleMessages.push(message.message) }
}))
import { attachRendererHealthEvents } from '../src/main/browser/tab-events/renderer-health-events.js'

// Ended from the Task manager, the tab said its page process crashed.

function harness(endedByPerson: boolean) {
  const page = new EventEmitter() as unknown as WebContents
  const tab = {
    id: 'tab', title: 'Fixture', url: 'https://example.com/', loading: true, networkConditionApplication: 'confirmed', networkConditionEpoch: 0,
    emulationApplication: 'confirmed', emulationRevision: 0, emulationContextGeneration: 0, nativeInputEnvironmentGeneration: 0,
    pageLifecycleState: 'active', consoleMessages: [] as string[], pageProblem: undefined as unknown
  }
  const taken: WebContents[] = []
  const browser = {
    changed: vi.fn(),
    setEmulationViewSize: vi.fn(),
    invalidateTabOverviewPreview: vi.fn(),
    tabOverviewPreviewCaptures: { cancelPending: vi.fn() },
    tabOverviewPreviewableTabs: new Set(),
    rendererRecovery: { expectsExit: () => false },
    endedByPerson: { take: (contents: WebContents) => { taken.push(contents); return endedByPerson } },
    networkWaitController: { reject: vi.fn() },
    cancelNativeSelectionSessions: vi.fn(),
    text: (key: string) => key,
    options: { getLocale: () => 'en-US' }
  }
  attachRendererHealthEvents(browser as never, tab as never, page)
  return { page, tab, taken }
}

describe('a tab whose page process exits', () => {
  it('says its page process was terminated when the person ended it in the Task manager', () => {
    const { page, tab, taken } = harness(true)
    ;(page as unknown as EventEmitter).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 5 })
    expect(taken).toEqual([page])
    expect(tab.pageProblem).toMatchObject({ kind: 'renderer-gone', reason: 'killed', exitCode: 5, message: 'The page process was terminated.' })
    expect(tab.consoleMessages).toEqual(['Renderer process exited: killed (exit code 5)'])
  })

  it('keeps the reason Electron gives otherwise', () => {
    const { page, tab } = harness(false)
    ;(page as unknown as EventEmitter).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 5 })
    expect(tab.pageProblem).toMatchObject({ reason: 'crashed', message: 'The page process crashed.' })
  })
})
