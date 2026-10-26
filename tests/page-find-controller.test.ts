import { EventEmitter } from 'node:events'
import type { WebContents } from 'electron'
import { afterEach, expect, it, vi } from 'vitest'
import { PageFindController } from '../src/main/browser/page-find-controller.js'

afterEach(() => vi.useRealTimers())

function fixture() {
  vi.useFakeTimers()
  let requestId = 0
  const contents = Object.assign(new EventEmitter(), {
    findInPage: vi.fn(() => ++requestId),
    stopFindInPage: vi.fn()
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
    expect(vi.getTimerCount()).toBe(1)
  }
  page.stop()
  expect(await Promise.all(searches)).toEqual(Array(20).fill('Page search was cancelled or superseded'))
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
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

it.each(['destroy', 'timeout', 'throw'] as const)('cleans up after %s and permits another search', async (failure) => {
  const page = fixture()
  if (failure === 'throw') page.contents.findInPage.mockImplementationOnce(() => { throw new Error('native failure') })
  const failed = page.search().catch(error => error.message)
  if (failure === 'destroy') page.contents.emit('destroyed')
  if (failure === 'timeout') await vi.advanceTimersByTimeAsync(5_000)
  expect(await failed).toMatch(/closed|Timed out|native failure/)
  expect(page.contents.listenerCount('found-in-page')).toBe(0)
  expect(page.contents.listenerCount('destroyed')).toBe(0)
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
