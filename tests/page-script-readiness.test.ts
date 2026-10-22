import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPageScriptsOnceDocumentReady } from '../src/main/browser/page-script-readiness.js'
import { PAGE_LOAD_WAIT_MS } from '../src/main/browser/page-waits/page-load-limit.js'

// Electron holds a page script until its main frame stops loading, so on a page whose load never ends, such as one
// with an image its server never answers, browser_snapshot, browser_click and every other page script waited forever.

afterEach(() => { vi.useRealTimers() })

/** A page that answers its scripts as Electron does: a call made while the main frame loads waits for it to stop. */
function loadingPage() {
  const page = Object.assign(new EventEmitter(), {
    loading: true,
    awaitingResponse: false,
    destroyed: false,
    url: 'https://example.test/',
    started: [] as string[],
    isDestroyed: () => page.destroyed,
    getURL: () => page.url,
    isLoadingMainFrame: () => page.loading,
    isWaitingForResponse: () => page.awaitingResponse,
    executeJavaScript: (code: string) => run(code),
    executeJavaScriptInIsolatedWorld: (_worldId: number, scripts: { code: string }[]) => run(scripts.map(script => script.code).join(''))
  })
  const run = async (code: string): Promise<string> => {
    if (!page.getURL() || page.isLoadingMainFrame()) await new Promise(resolve => page.once('did-stop-loading', resolve))
    page.started.push(code)
    return code
  }
  runPageScriptsOnceDocumentReady(page as never)
  return page
}

function startNavigation(page: ReturnType<typeof loadingPage>): void {
  page.awaitingResponse = true
  page.emit('did-start-navigation', {}, 'https://next.example.test/', false, true)
}

function showNextDocument(page: ReturnType<typeof loadingPage>): void {
  page.awaitingResponse = false
  page.emit('did-navigate')
}

/** Lets pending promise callbacks run. */
const settle = async () => { for (let turn = 0; turn < 5; turn += 1) await Promise.resolve() }

describe('running page scripts on a page that is still loading', () => {
  it('runs a script once the document is ready, while the page goes on loading', async () => {
    const page = loadingPage()
    page.emit('dom-ready')
    await expect(page.executeJavaScript('main')).resolves.toBe('main')
    await expect(page.executeJavaScriptInIsolatedWorld(999, [{ code: 'isolated' }])).resolves.toBe('isolated')
    // Everyone else still sees the page loading.
    expect(page.isLoadingMainFrame()).toBe(true)
  })

  it('waits for the document of a page that has not shown yet', async () => {
    const page = loadingPage()
    const call = page.executeJavaScript('early')
    await settle()
    expect(page.started).toEqual([])
    page.emit('dom-ready')
    await expect(call).resolves.toBe('early')
  })

  it('waits for the next document once the tab starts opening one, but not for a change within the page or a frame', async () => {
    const page = loadingPage()
    page.emit('dom-ready')
    page.emit('did-start-navigation', {}, 'https://example.test/#part', true, true)
    page.emit('did-start-navigation', {}, 'https://frame.example.test/', false, false)
    await expect(page.executeJavaScript('same page')).resolves.toBe('same page')
    startNavigation(page)
    const call = page.executeJavaScript('next page')
    // The page it leaves can still finish parsing, as when a script in its head opens another address.
    page.emit('dom-ready')
    await settle()
    expect(page.started).toEqual(['same page'])
    showNextDocument(page)
    const parsing = page.executeJavaScript('new document')
    await settle()
    expect(page.started).toEqual(['same page'])
    page.emit('dom-ready')
    await expect(call).resolves.toBe('next page')
    await expect(parsing).resolves.toBe('new document')
  })

  it('waits for the error page a failed navigation shows', async () => {
    const page = loadingPage()
    page.emit('dom-ready')
    startNavigation(page)
    page.awaitingResponse = false
    page.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example.test/', false)
    page.emit('did-fail-provisional-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://next.example.test/', true)
    const call = page.executeJavaScript('error page')
    await settle()
    expect(page.started).toEqual([])
    page.emit('dom-ready')
    await expect(call).resolves.toBe('error page')
  })

  it('runs in the shown document soon after a navigation ends with no document and no event, as a 204 does', async () => {
    vi.useFakeTimers()
    const page = loadingPage()
    startNavigation(page)
    const call = page.executeJavaScript('after 204')
    // The shown document became ready after the navigation started.
    page.emit('dom-ready')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(page.started).toEqual([])
    page.awaitingResponse = false
    // The document could still be on its way to the tab.
    await vi.advanceTimersByTimeAsync(2_500)
    expect(page.started).toEqual([])
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(call).resolves.toBe('after 204')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs a waiting script in the shown document once the wait has passed', async () => {
    vi.useFakeTimers()
    const page = loadingPage()
    // A document that never reaches its DOMContentLoaded, as one held by a script its server never answers.
    const call = page.executeJavaScript('late')
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS - 1)
    expect(page.started).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    await expect(call).resolves.toBe('late')
  })

  it('fails a waiting script once the wait has passed while the next document is still awaited from its server', async () => {
    vi.useFakeTimers()
    const page = loadingPage()
    page.emit('dom-ready')
    startNavigation(page)
    const call = page.executeJavaScript('submitted')
    const outcome = expect(call).rejects.toMatchObject({ message: 'Timed out waiting for the page to finish loading.' })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await outcome
    expect(page.started).toEqual([])
  })

  it('fails a waiting script once the wait has passed while the tab shows no document', async () => {
    vi.useFakeTimers()
    const page = loadingPage()
    page.url = ''
    const call = page.executeJavaScript('nothing shown')
    const outcome = expect(call).rejects.toMatchObject({ message: 'Timed out waiting for the page to finish loading.' })
    await vi.advanceTimersByTimeAsync(PAGE_LOAD_WAIT_MS)
    await outcome
    expect(page.started).toEqual([])
  })

  it('starts a waiting script at once when its renderer goes or the page closes, so the call settles', async () => {
    const page = loadingPage()
    const gone = page.executeJavaScript('gone')
    await settle()
    page.emit('render-process-gone')
    await expect(gone).resolves.toBe('gone')
    const closed = page.executeJavaScript('closed')
    await settle()
    page.destroyed = true
    page.emit('destroyed')
    await expect(closed).resolves.toBe('closed')
  })

  it('keeps no listener or timer per waiting script', async () => {
    vi.useFakeTimers()
    const page = loadingPage()
    const before = page.eventNames().map(name => page.listenerCount(name))
    const calls = Array.from({ length: 20 }, (_, index) => page.executeJavaScript(`call ${index}`))
    expect(page.eventNames().map(name => page.listenerCount(name))).toEqual(before)
    expect(vi.getTimerCount()).toBe(21)
    page.emit('dom-ready')
    await expect(Promise.all(calls)).resolves.toHaveLength(20)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs at once when the page is not loading', async () => {
    const page = loadingPage()
    page.loading = false
    await expect(page.executeJavaScript('loaded')).resolves.toBe('loaded')
  })
})
