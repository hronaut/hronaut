import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { waitForElement, waitForText } from '../src/main/browser/page-waits/page-waits.js'
import { drainWorkspaceOperations } from '../src/main/browser/quit-flush/quit-flush.js'

/** As a Linux clock kept in local time is corrected soon after login: the wall clock steps an hour back. */
const stepWallClockBack = (): void => {
  vi.setSystemTime(Date.now() - 3_600_000)
}

/** A browser with one tab whose page never shows what a wait looks for; the wall clock steps back as it first looks. */
function browserWithTab(): Browser {
  let stepped = false
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    executeJavaScript: vi.fn(async () => {
      if (!stepped) stepWallClockBack()
      stepped = true
      return null
    })
  })
  const tab = { id: 'tab-1', webContents }
  return { tabs: new Map([[tab.id, tab]]), activeTabId: tab.id } as unknown as Browser
}

/** What the promise settled with so far, without waiting for it. */
function track<Value>(promise: Promise<Value>): { settled?: { value?: Value, error?: unknown } } {
  const tracked: { settled?: { value?: Value, error?: unknown } } = {}
  promise.then((value) => { tracked.settled = { value } }, (error: unknown) => { tracked.settled = { error } })
  return tracked
}

describe('deadlines when the wall clock steps back', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ends a wait for page text or an element at its timeout', async () => {
    const text = track(waitForText(browserWithTab(), 'Ready', 'tab-1', 1_000))
    const element = track(waitForElement(browserWithTab(), { selector: '#ready' }, 'tab-1', 1_000))
    await vi.advanceTimersByTimeAsync(1_200)
    expect(text.settled).toEqual({ value: null })
    expect(element.settled).toEqual({ value: false })
  })

  it('stops waiting for workspace operations at quit after eight seconds', async () => {
    const pending = new Set<Promise<unknown>>()
    const first = new Promise<void>((resolve) => setTimeout(resolve, 1_000)).then(() => {
      pending.delete(first)
      // The operation that finishes after the clock stepped back starts another, which never finishes.
      stepWallClockBack()
      pending.add(new Promise(() => undefined))
    })
    pending.add(first)
    const draining = track(drainWorkspaceOperations({ pendingWorkspaceOperationPromises: pending } as unknown as Browser))
    await vi.advanceTimersByTimeAsync(8_100)
    expect(draining.settled?.error).toEqual(new Error('Workspace operations did not finish within 8000 ms.'))
  })
})
