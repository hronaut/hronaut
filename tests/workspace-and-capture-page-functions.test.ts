// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollTargetInPage } from '../src/main/browser/agent-page-actions/form-input-and-scroll.page.js'
import { decodeFaviconInPage } from '../src/main/browser/favicon.page.js'
import { targetElementInPage } from '../src/main/browser/page-scripts/target-action.page.js'
import { exitFullscreenInPage } from '../src/main/browser/page-fullscreen/page-fullscreen.page.js'
import { pageTextMatchInPage } from '../src/main/browser/page-waits/page-waits.page.js'
import { screenshotClipInPage, screenshotTargetClipInPage } from '../src/main/browser/screenshots/screenshots.page.js'
import { workerResultInPage } from '../src/main/browser/worker-evaluation/worker-evaluation.page.js'
import {
  mergeLocalStorageInPage,
  readLocalStorageInPage,
  removeUnchangedLocalStorageInPage,
  restoreLocalStorageInPage
} from '../src/main/browser/workspace-storage.page.js'
import { pageScript } from '../src/shared/page-script.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  vi.useRealTimers()
  document.body.innerHTML = ''
  localStorage.clear()
})

/** Sets a property of an object for one test, as the page or the browser would have it. */
function stub(target: object, key: string, value: unknown): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
  cleanups.push(() => {
    if (descriptor) Object.defineProperty(target, key, descriptor)
    else Reflect.deleteProperty(target, key)
  })
}

const run = <T>(script: string): T => window.eval(script) as T

describe('the workspace storage, wait, screenshot, scroll, full screen, favicon and worker page functions', () => {
  it('reads, merges, removes what is unchanged and restores an origin\'s local storage', () => {
    localStorage.setItem('kept', 'one')
    localStorage.setItem('empty', '')
    expect(run<Array<[string, string]>>(pageScript(readLocalStorageInPage)).sort()).toEqual([['empty', ''], ['kept', 'one']])
    run(pageScript(mergeLocalStorageInPage, [['copied', 'été'], ['kept', 'two']]))
    expect(localStorage.getItem('copied')).toBe('été')
    expect(localStorage.getItem('kept')).toBe('two')
    localStorage.setItem('changed', 'page')
    expect(run(pageScript(removeUnchangedLocalStorageInPage, [['copied', 'été'], ['changed', 'copy'], ['gone', 'x']]))).toBe(2)
    expect(localStorage.getItem('copied')).toBeNull()
    expect(localStorage.getItem('changed')).toBe('page')
    localStorage.setItem('added', 'new')
    run(pageScript(restoreLocalStorageInPage, [['kept', 'one']], [['kept', 'two'], ['changed', 'copy'], ['added', 'new']]))
    expect(Object.fromEntries(run<Array<[string, string]>>(pageScript(readLocalStorageInPage)))).toEqual({ empty: '', kept: 'one', changed: 'page' })
  })

  it('finds the first text the page shows', () => {
    expect(run(pageScript(pageTextMatchInPage, ['Saved']))).toBeNull()
    document.body.innerHTML = '<p>Draft saved</p>'
    // jsdom lays nothing out, so it has no innerText, which every browser has.
    stub(document.body, 'innerText', document.body.textContent)
    expect(run(pageScript(pageTextMatchInPage, ['Published', 'saved', 'Draft']))).toBe('saved')
  })

  it('gives the part of the document a screenshot target or viewport clip covers', async () => {
    const missing = 'Screenshot target not found.'
    const hidden = 'Screenshot target has no visible area.'
    await expect(run<Promise<unknown>>(pageScript(screenshotTargetClipInPage, { selector: '#shot' }, targetElementInPage, missing, hidden))).rejects.toThrow(missing)
    document.body.innerHTML = '<div id="shot"></div>'
    const element = document.querySelector('#shot')!
    stub(element, 'scrollIntoView', () => undefined)
    await expect(run<Promise<unknown>>(pageScript(screenshotTargetClipInPage, { selector: '#shot' }, targetElementInPage, missing, hidden))).rejects.toThrow(hidden)
    stub(element, 'getBoundingClientRect', () => ({ left: -10, top: 20, width: 100, height: 50 }))
    stub(document.documentElement, 'scrollWidth', 1_000)
    stub(document.documentElement, 'scrollHeight', 60)
    await expect(run<Promise<unknown>>(pageScript(screenshotTargetClipInPage, { selector: '#shot' }, targetElementInPage, missing, hidden)))
      .resolves.toEqual({ x: 0, y: 20, width: 90, height: 40 })
    // A scrolled page moves the element's place in the document by the scroll offsets.
    stub(window, 'scrollX', 30)
    stub(window, 'scrollY', 5)
    await expect(run<Promise<unknown>>(pageScript(screenshotTargetClipInPage, { selector: '#shot' }, targetElementInPage, missing, hidden)))
      .resolves.toEqual({ x: 20, y: 25, width: 100, height: 35 })

    stub(window, 'innerWidth', 800)
    stub(window, 'innerHeight', 600)
    expect(run(pageScript(screenshotClipInPage, { x: 10, y: 20, width: 100, height: 50 }))).toEqual({ x: 40, y: 25, width: 100, height: 50 })
    expect(() => run(pageScript(screenshotClipInPage, { x: 750, y: 0, width: 100, height: 50 }))).toThrow('Screenshot clip must fit inside the visible viewport.')
  })

  it('scrolls the target, or the page when there is none, and refuses a target that is missing', () => {
    const pageScroll = vi.fn()
    stub(window, 'scrollBy', pageScroll)
    stub(document, 'scrollingElement', document.documentElement)
    expect(run(pageScript(scrollTargetInPage, null, 5, 600, targetElementInPage))).toEqual({ x: 0, y: 0 })
    expect(pageScroll).toHaveBeenCalledWith({ left: 5, top: 600, behavior: 'instant' })
    // A target that is the page's scrolling element scrolls the window too.
    run(pageScript(scrollTargetInPage, { selector: 'html' }, 2, 3, targetElementInPage))
    expect(pageScroll).toHaveBeenLastCalledWith({ left: 2, top: 3, behavior: 'instant' })
    document.body.innerHTML = '<div id="list"></div>'
    const list = document.querySelector('#list')!
    const listScroll = vi.fn()
    stub(list, 'scrollBy', listScroll)
    run(pageScript(scrollTargetInPage, { selector: '#list' }, -3, 0, targetElementInPage))
    expect(listScroll).toHaveBeenCalledWith({ left: -3, top: 0, behavior: 'instant' })
    expect(() => run(pageScript(scrollTargetInPage, { ref: 'e9' }, 0, 1, targetElementInPage))).toThrow('Scroll target not found.')
  })

  it('leaves full screen, waits for it when the document has not shown it yet, and gives up after 2 seconds', async () => {
    vi.useFakeTimers()
    const exitFullscreen = vi.fn(async () => undefined)
    stub(document, 'exitFullscreen', exitFullscreen)
    stub(document, 'fullscreenElement', document.body)
    await expect(run<Promise<boolean>>(pageScript(exitFullscreenInPage))).resolves.toBe(true)
    stub(document, 'fullscreenElement', null)
    const waiting = run<Promise<boolean>>(pageScript(exitFullscreenInPage))
    stub(document, 'fullscreenElement', document.body)
    document.dispatchEvent(new Event('fullscreenchange'))
    await expect(waiting).resolves.toBe(true)
    stub(document, 'fullscreenElement', null)
    const never = run<Promise<boolean>>(pageScript(exitFullscreenInPage))
    vi.advanceTimersByTime(2_000)
    await expect(never).resolves.toBe(false)
    expect(exitFullscreen).toHaveBeenCalledTimes(2)
  })

  it('gives a favicon that does not load as null', async () => {
    vi.useFakeTimers()
    const failed = run<Promise<unknown>>(pageScript(decodeFaviconInPage, 'data:image/png;base64,broken'))
    vi.advanceTimersByTime(5_000)
    await expect(failed).resolves.toBeNull()
  })

  it('gives a worker script\'s value as JSON text, cut at the limit', async () => {
    await expect(run<Promise<unknown>>(pageScript(workerResultInPage, 'void 0', 10))).resolves.toEqual({ kind: 'undefined' })
    await expect(run<Promise<unknown>>(pageScript(workerResultInPage, 'Promise.resolve({ a: 1 })', 10))).resolves.toEqual({ kind: 'json', text: '{"a":1}' })
    await expect(run<Promise<unknown>>(pageScript(workerResultInPage, '"x".repeat(20)', 10))).resolves.toEqual({ kind: 'truncated', text: '"xxxxxxxxx', totalChars: 22 })
    await expect(run<Promise<unknown>>(pageScript(workerResultInPage, '(() => { const loop = {}; loop.self = loop; return loop })()', 10))).resolves.toEqual({ kind: 'unserializable' })
    await expect(run<Promise<unknown>>(pageScript(workerResultInPage, '() => 1', 10))).resolves.toEqual({ kind: 'unserializable' })
    // Indirect eval runs in the global scope: a var the script declares is global, not the wrapper's.
    await run(pageScript(workerResultInPage, 'var declaredByWorkerScript = 7', 10))
    expect((window as unknown as Record<string, unknown>).declaredByWorkerScript).toBe(7)
    Reflect.deleteProperty(window, 'declaredByWorkerScript')
  })
})
