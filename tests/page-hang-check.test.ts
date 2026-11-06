import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
// The browser below stubs changed, which showing and clearing the problem publish through.
vi.mock('../src/main/browser/browser-state/browser-state.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/main/browser/browser-state/browser-state.js')>(),
  publishChange: (browser: { changed: (persist?: boolean) => void }, persist?: boolean) => browser.changed(persist)
}))
const { attachRendererHealthEvents, HANG_DELAY_MS } = await import('../src/main/browser/tab-events/renderer-health-events.js')

// A page stuck in a loop never said it was not responding: Chromium reports no hang while a debugger is attached, and
// every tab keeps Hronaut's attached. The e2e page-hang-check drives a real stuck page.

function harness() {
  const answers: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = []
  const state = { loading: false, devTools: false }
  const page = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isCrashed: () => false,
    isLoadingMainFrame: () => state.loading,
    isDevToolsOpened: () => state.devTools,
    executeJavaScriptInIsolatedWorld: vi.fn(() => new Promise((resolve, reject) => { answers.push({ resolve, reject }) }))
  })
  const tab = {
    id: 'tab', url: 'https://example.com/', navigationGeneration: 1, pageProblem: undefined as { kind: string } | undefined, dialog: undefined as unknown
  }
  const browser = { changed: vi.fn(), text: (key: string) => key }
  attachRendererHealthEvents(browser as never, tab as never, page as unknown as WebContents)
  return { page, tab, answers, state, input: () => page.emit('input-event', {}, { type: 'keyDown' }) }
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('input a page leaves unanswered', () => {
  it('shows the page is not responding after the hang delay, once per check, and clears when the page answers', async () => {
    const { page, tab, answers, input } = harness()
    input()
    input()
    expect(page.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(HANG_DELAY_MS - 1)
    expect(tab.pageProblem).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1)
    expect(tab.pageProblem).toMatchObject({ kind: 'unresponsive', title: 'native.dialog.unresponsiveTitle' })
    answers[0]!.resolve(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(tab.pageProblem).toBeUndefined()
  })

  it('shows nothing for a page that answers in time, and checks again on the next input', async () => {
    const { page, tab, answers, input } = harness()
    input()
    answers[0]!.resolve(true)
    await vi.advanceTimersByTimeAsync(HANG_DELAY_MS * 2)
    expect(tab.pageProblem).toBeUndefined()
    input()
    expect(page.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
  })

  it('does not check a page loading its document, holding an alert or paused in DevTools', async () => {
    const { page, tab, state, input } = harness()
    state.loading = true
    input()
    state.loading = false
    state.devTools = true
    input()
    state.devTools = false
    tab.dialog = { type: 'alert' }
    input()
    expect(page.executeJavaScriptInIsolatedWorld).not.toHaveBeenCalled()
  })

  it('shows nothing when a navigation or an alert overtook the check', async () => {
    const navigated = harness()
    navigated.input()
    navigated.tab.navigationGeneration++
    await vi.advanceTimersByTimeAsync(HANG_DELAY_MS)
    expect(navigated.tab.pageProblem).toBeUndefined()

    const alerted = harness()
    alerted.input()
    alerted.tab.dialog = { type: 'alert' }
    await vi.advanceTimersByTimeAsync(HANG_DELAY_MS)
    expect(alerted.tab.pageProblem).toBeUndefined()
  })

  it('gives way to a new check when an answer never comes', async () => {
    const { page, input } = harness()
    input()
    await vi.advanceTimersByTimeAsync(HANG_DELAY_MS)
    input()
    expect(page.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(2)
  })
})
