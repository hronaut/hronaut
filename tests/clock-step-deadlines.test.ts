import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Browser } from '../src/main/browser/browser.js'
import { imageState } from '../src/main/browser/element-inspection/element-inspection.js'
import { ImageInspectionSlots } from '../src/main/browser/image-state.js'
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

/** A website tab whose image state script reports a target it did not find, recording each script it was given. */
function imageStateBrowser(): { browser: Browser, scripts: string[] } {
  const scripts: string[] = []
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, sources: Array<{ code: string }>) => {
      scripts.push(sources[0]!.code)
      return { failure: 'missing-target' }
    })
  })
  const tab = { id: 'tab-1', url: 'https://example.test/', webContents, sleeping: false, pageLifecycleState: 'active' }
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    activeTabId: tab.id,
    destroyed: false,
    mcpTabGroups: new Map(),
    inspectionPermissions: new Map(),
    imageInspectionSlots: new ImageInspectionSlots(),
    snapshotDeltaContext: () => ({ snapshotFormatVersion: 1, tabId: tab.id, observationGeneration: 0, navigationGeneration: 0, humanInteractionGeneration: 0 })
  } as unknown as Browser
  return { browser, scripts }
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

  it('gives the image state script its deadline on the page\'s own wall clock', async () => {
    const { browser, scripts } = imageStateBrowser()
    await expect(imageState(browser, { selector: 'img' })).rejects.toThrow('Image state target not found')
    // The script's last argument is the deadline, which the page compares with its Date.now().
    const deadline = Number(/,\s*(\d+(?:\.\d+)?)\s*\)\s*;?\s*$/.exec(scripts[0]!)?.[1])
    expect(deadline).toBeGreaterThanOrEqual(Date.now() + 4_900)
    expect(deadline).toBeLessThanOrEqual(Date.now() + 5_000)
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
