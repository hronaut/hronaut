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
    stop: () => controller.stop(webContents),
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
