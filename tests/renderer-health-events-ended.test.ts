import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { attachRendererHealthEvents } from '../src/main/browser/tab-events/renderer-health-events.js'
import type { RendererHealthEventsAccess, RendererHealthEventsTab } from '../src/main/browser/tab-events/renderer-health-events-access.js'

// Ended from the Task manager, the tab said its page process crashed.

function harness(endedByPerson: boolean) {
  const page = new EventEmitter() as unknown as WebContents
  const tab: RendererHealthEventsTab & { consoleMessages: string[] } = {
    id: 'tab', title: 'Fixture', url: 'https://example.com/', loading: true, networkConditionApplication: 'confirmed',
    emulationApplication: 'confirmed', emulationRevision: 0, emulationContextGeneration: 0, nativeInputEnvironmentGeneration: 0,
    pageLifecycleState: 'active', consoleMessages: []
  }
  const taken: WebContents[] = []
  const access: RendererHealthEventsAccess<typeof tab> = {
    markNetworkConditionsUnknown: vi.fn(),
    changed: vi.fn(),
    setEmulationViewSize: vi.fn(),
    invalidateTabOverviewPreview: vi.fn(),
    tabOverviewPreviewCaptures: () => ({ cancelPending: vi.fn() }),
    tabOverviewPreviewableTabs: () => new Set(),
    rendererRecovery: () => ({ expectsExit: () => false }),
    takeEndedByPerson: (contents) => { taken.push(contents); return endedByPerson },
    networkWaitController: () => ({ reject: vi.fn() }),
    cancelNativeSelectionSessions: vi.fn(),
    text: (key) => key,
    options: () => ({ getLocale: () => 'en-US' }),
    appendConsoleMessage: (target, message) => { target.consoleMessages.push(message.message) }
  }
  attachRendererHealthEvents(access, tab, page)
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
