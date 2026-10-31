import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { PageFindController } from '../src/main/browser/page-find-controller.js'
import { ISOLATED_WORLDS } from '../src/main/browser/isolated-worlds.js'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  let requestId = 0
  const contents = Object.assign(new EventEmitter(), {
    findInPage: vi.fn(() => ++requestId),
    stopFindInPage: vi.fn(),
    executeJavaScriptInIsolatedWorld: vi.fn(() => Promise.resolve())
  })
  const controller = new PageFindController()
  const webContents = contents as unknown as WebContents
  return {
    contents,
    search: () => controller.search(webContents, 'needle', {}),
    stop: (action?: 'clearSelection' | 'activateSelection') => controller.stop(webContents, action),
    complete: (id = requestId, finalUpdate = true) => contents.emit('found-in-page', {}, {
      requestId: id, finalUpdate, activeMatchOrdinal: 1, matches: 3
    })
  }
}

it('settles superseded searches and cancellation without retaining listeners or timers', async () => {
  const page = fixture()
  const searches = []
  for (let index = 0; index < 20; index += 1) {
    searches.push(page.search().catch(error => error.message))
    expect(page.contents.listenerCount('found-in-page')).toBe(1)
    expect(page.contents.listenerCount('destroyed')).toBe(1)
    expect(page.contents.listenerCount('render-process-gone')).toBe(1)
  }
  page.stop()
  expect(await Promise.all(searches)).toEqual(Array(20).fill('Page search was cancelled or superseded'))
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
  expect(page.contents.listenerCount('render-process-gone')).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  expect(page.contents.stopFindInPage).toHaveBeenCalledWith('clearSelection')
})

it('ignores stale and partial results and preserves unrelated listeners', async () => {
  const page = fixture()
  const observer = vi.fn()
  page.contents.on('found-in-page', observer)
  const old = page.search().catch(error => error.message)
  const current = page.search()
  page.complete(1)
  page.complete(2, false)
  expect(page.contents.listenerCount('found-in-page')).toBe(2)
  page.complete(2)
  await expect(current).resolves.toEqual({ activeMatchOrdinal: 1, matches: 3 })
  await expect(old).resolves.toContain('superseded')
  expect(observer).toHaveBeenCalledTimes(3)
  expect(page.contents.listeners('found-in-page')).toEqual([observer])
  expect(vi.getTimerCount()).toBe(0)
})

// A very long page, such as a large log, takes many seconds to count its matches; Chromium then answers once, at the
// end. The search failed after 5 seconds, so Find showed that it failed, and trying again failed the same way.
it('waits for a page that takes long to count its matches', async () => {
  const page = fixture()
  const search = page.search()
  await vi.advanceTimersByTimeAsync(60_000)
  page.complete()
  await expect(search).resolves.toEqual({ activeMatchOrdinal: 1, matches: 3 })
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
  expect(page.contents.listenerCount('render-process-gone')).toBe(0)
})

// Chromium answers at once when it has nothing to search, such as a page whose renderer is gone, and that answer can come
// before findInPage returns the request's id. Without a time limit, a search that missed it read Searching... forever.
it('takes an answer Chromium sends before findInPage returns', async () => {
  const page = fixture()
  page.contents.findInPage.mockImplementationOnce(() => {
    page.complete(0)
    page.contents.emit('found-in-page', {}, { requestId: 1, finalUpdate: false, activeMatchOrdinal: 1, matches: 1 })
    page.contents.emit('found-in-page', {}, { requestId: 1, finalUpdate: true, activeMatchOrdinal: 0, matches: 0 })
    return 1
  })
  await expect(page.search()).resolves.toEqual({ activeMatchOrdinal: 0, matches: 0 })
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
  expect(page.contents.listenerCount('render-process-gone')).toBe(0)
  expect(page.stop('activateSelection')).toBe(false)
})

it('ignores an early answer to another request and waits for its own', async () => {
  const page = fixture()
  page.contents.findInPage.mockImplementationOnce(() => {
    page.complete(7)
    return 8
  })
  const search = page.search()
  await vi.advanceTimersByTimeAsync(0)
  expect(page.contents.listenerCount('found-in-page')).toBe(1)
  page.complete(8)
  await expect(search).resolves.toEqual({ activeMatchOrdinal: 1, matches: 3 })
})

it.each([
  ['destroy', 'Tab was closed while searching the page'],
  ['renderer exit', 'The page stopped while searching it'],
  ['throw', 'native failure']
] as const)('cleans up after %s and permits another search', async (failure, message) => {
  const page = fixture()
  if (failure === 'throw') page.contents.findInPage.mockImplementationOnce(() => { throw new Error('native failure') })
  const failed = page.search().catch(error => error.message)
  if (failure === 'destroy') page.contents.emit('destroyed')
  if (failure === 'renderer exit') page.contents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 })
  expect(await failed).toBe(message)
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
  expect(page.contents.listenerCount('render-process-gone')).toBe(0)
  expect(vi.getTimerCount()).toBe(0)
  const next = page.search()
  page.complete()
  await expect(next).resolves.toEqual({ activeMatchOrdinal: 1, matches: 3 })
})

it('keeps searches in different pages independent', async () => {
  vi.useFakeTimers()
  const controller = new PageFindController()
  const pages = [0, 1].map(() => Object.assign(new EventEmitter(), {
    findInPage: () => 1, stopFindInPage: vi.fn()
  }))
  const pending = pages.map(page => controller.search(page as unknown as WebContents, 'needle', {}).catch(error => error.message))
  controller.stop(pages[0] as unknown as WebContents)
  expect(pages[1]!.listenerCount('found-in-page')).toBe(1)
  pages[1]!.emit('found-in-page', {}, { requestId: 1, finalUpdate: true, activeMatchOrdinal: 2, matches: 4 })
  expect(await Promise.all(pending)).toEqual(['Page search was cancelled or superseded', { activeMatchOrdinal: 2, matches: 4 }])
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the selection when a search ends, and clicks only an active match a search settled on', async () => {
  const page = fixture()
  const settle = async (activeMatchOrdinal: number) => {
    const search = page.search()
    const requestId = page.contents.findInPage.mock.results.at(-1)!.value as number
    page.contents.emit('found-in-page', {}, { requestId, finalUpdate: true, activeMatchOrdinal, matches: activeMatchOrdinal ? 3 : 0 })
    await search
  }
  // Chromium clicks the page's focused element, which is the match's link only once a search found it: before, it is
  // whatever had the focus, such as a button the person pressed.
  const unanswered = page.search().catch(error => error.message)
  expect(page.stop('activateSelection')).toBe(false)
  expect(await unanswered).toBe('Page search was cancelled or superseded')
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection')

  await settle(1)
  expect(page.stop()).toBe(false)
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection')
  await settle(1)
  expect(page.stop('activateSelection')).toBe(true)
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('activateSelection')
  // The search ended with it.
  expect(page.stop('activateSelection')).toBe(false)
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection')

  await settle(0)
  expect(page.stop('activateSelection')).toBe(false)
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection')

  // A match, then a search that has not answered yet.
  await settle(1)
  const next = page.search().catch(error => error.message)
  expect(page.stop('activateSelection')).toBe(false)
  expect(page.contents.stopFindInPage).toHaveBeenLastCalledWith('clearSelection')
  expect(await next).toBe('Page search was cancelled or superseded')
})

// The person's Ctrl+Enter went to Find, not to the page, so Chromium clicked the link with no user activation and
// skipped the page the link left on Back, as it skips pages that move on by themselves.
it('gives the page the person\'s activation before it clicks the match, and only then', async () => {
  const page = fixture()
  const calls: string[] = []
  page.contents.executeJavaScriptInIsolatedWorld.mockImplementation(((worldId: number, scripts: { code: string }[], userGesture: boolean) => {
    calls.push(`activate ${worldId} ${JSON.stringify(scripts)} ${userGesture}`)
    return Promise.reject(new Error('Page went away'))
  }) as never)
  page.contents.stopFindInPage.mockImplementation(((action: string) => { calls.push(`stop ${action}`) }) as never)

  const search = page.search()
  page.complete()
  await search
  expect(page.stop('activateSelection')).toBe(true)
  expect(calls).toEqual([`activate ${ISOLATED_WORLDS.findMatchClick} [{"code":"void 0"}] true`, 'stop activateSelection'])

  // Nothing to click: no search, a search with no match, or a stop that does not click.
  calls.length = 0
  expect(page.stop('activateSelection')).toBe(false)
  const empty = page.search()
  page.contents.emit('found-in-page', {}, { requestId: page.contents.findInPage.mock.results.at(-1)!.value, finalUpdate: true, activeMatchOrdinal: 0, matches: 0 })
  await empty
  expect(page.stop('activateSelection')).toBe(false)
  const matched = page.search()
  page.complete()
  await matched
  expect(page.stop()).toBe(false)
  expect(calls).toEqual(['stop clearSelection', 'stop clearSelection', 'stop clearSelection'])
  // A page that went away meanwhile leaves no unhandled rejection.
  await Promise.resolve()
})

it('ends a search session before a new one finds the same text again, so its active match can still be clicked', () => {
  const page = fixture()
  const controller = new PageFindController()
  const webContents = page.contents as unknown as WebContents
  const calls: string[] = []
  page.contents.findInPage.mockImplementation(((query: string, options: Electron.FindInPageOptions) => {
    calls.push(`find ${query}${options.findNext ? ' new' : ''}${options.matchCase ? ' case' : ''}`)
    return calls.length
  }) as never)
  page.contents.stopFindInPage.mockImplementation(((action: string) => { calls.push(`stop ${action}`) }) as never)
  const search = (query: string, options: Electron.FindInPageOptions) => { void controller.search(webContents, query, options).catch(() => undefined) }

  search('pricing', { findNext: true })
  search('pricing details', { findNext: true })
  search('pricing details', { findNext: false })
  search('pricing details', { findNext: true, matchCase: true })
  search('Pricing Details', { findNext: true })
  controller.stop(webContents)
  search('pricing details', { findNext: true })

  expect(calls).toEqual([
    'find pricing new',
    'find pricing details new',
    'find pricing details',
    // Match case switched: the same text again.
    'stop clearSelection',
    'find pricing details new case',
    'stop clearSelection',
    'find Pricing Details new',
    'stop clearSelection',
    // The search was stopped already.
    'find pricing details new'
  ])
})
