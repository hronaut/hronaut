// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { humanInteractionWheelGuardInPage } from '../src/main/browser/interaction-lock/human-input-guard.page.js'
import { holdPageAnimationsInPage, restorePageAnimationsInPage } from '../src/main/browser/page-lifecycle/page-lifecycle.page.js'
import { webStorageInPage } from '../src/main/browser/site-storage/manage-storage.page.js'
import { storageSnapshotInPage } from '../src/main/browser/site-storage/storage-changes.page.js'
import { storageEstimateInPage } from '../src/main/browser/site-storage/storage-inspection.page.js'
import { formStateChangedInPage, pictureInPictureShownInPage } from '../src/main/browser/tab-sleep/tab-sleep.page.js'
import { watchFormEditsInPage } from '../src/main/browser/tab-sleep/unsaved-form-edits.page.js'
import { pageScript } from '../src/shared/page-script.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
  document.body.innerHTML = ''
  localStorage.clear()
  sessionStorage.clear()
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

describe('the tab sleep, page lifecycle, input guard and storage page functions', () => {
  it('finds changed form input, in shadow roots too, and content edits its watcher recorded', () => {
    stub(window, '__hronautFormEditTrackingInstalled', undefined)
    stub(window, '__hronautContentEditableDirty', undefined)
    document.body.innerHTML = '<input value="kept"><select><option>a</option><option selected>b</option></select><button>Go</button><div contenteditable="true">draft</div>'
    expect(run(pageScript(formStateChangedInPage))).toBe(false)
    const host = document.createElement('div')
    document.body.append(host)
    const field = document.createElement('textarea')
    host.attachShadow({ mode: 'open' }).append(field)
    field.value = 'typed'
    expect(run(pageScript(formStateChangedInPage))).toBe(true)
    field.value = ''

    run(pageScript(watchFormEditsInPage))
    run(pageScript(watchFormEditsInPage))
    expect(run(pageScript(formStateChangedInPage))).toBe(false)
    const editor = document.querySelector<HTMLElement>('[contenteditable]')!
    // jsdom has no isContentEditable, which every browser has.
    stub(editor, 'isContentEditable', true)
    editor.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    expect(run(pageScript(formStateChangedInPage))).toBe(true)
  })

  it('finds a video or a window of the document in Picture in picture', () => {
    expect(run(pageScript(pictureInPictureShownInPage))).toBe(false)
    stub(window, 'documentPictureInPicture', { window: null })
    expect(run(pageScript(pictureInPictureShownInPage))).toBe(false)
    stub(window, 'documentPictureInPicture', { window: {} })
    expect(run(pageScript(pictureInPictureShownInPage))).toBe(true)
    stub(window, 'documentPictureInPicture', undefined)
    stub(document, 'pictureInPictureElement', document.body)
    expect(run(pageScript(pictureInPictureShownInPage))).toBe(true)
  })

  it('holds the page\'s animations while it is frozen and gives them back their times and rates', () => {
    expect(run(pageScript(holdPageAnimationsInPage, 2))).toEqual([])
    const animations = [
      { currentTime: 120, playbackRate: 1 },
      { currentTime: null, playbackRate: 2 },
      { currentTime: 5, playbackRate: 1 }
    ]
    stub(document, 'getAnimations', () => animations)
    expect(run(pageScript(holdPageAnimationsInPage, 2))).toEqual([{ currentTime: 120, playbackRate: 1 }, { currentTime: null, playbackRate: 2 }])
    expect(animations.map(animation => animation.playbackRate)).toEqual([0, 0, 1])
    animations[0]!.currentTime = 400
    run(pageScript(restorePageAnimationsInPage, [{ currentTime: 120, playbackRate: 1 }, { currentTime: null, playbackRate: 2 }]))
    expect(animations).toEqual([{ currentTime: 120, playbackRate: 1 }, { currentTime: null, playbackRate: 2 }, { currentTime: 5, playbackRate: 1 }])
    stub(document, 'getAnimations', () => { throw new Error('page broke it') })
    expect(() => run(pageScript(restorePageAnimationsInPage, [{ currentTime: 1, playbackRate: 1 }]))).not.toThrow()
  })

  it('cancels wheel events in the frame while the person\'s input is locked, and only then', () => {
    const wheel = (): boolean => window.dispatchEvent(new WheelEvent('wheel', { cancelable: true }))
    run(pageScript(humanInteractionWheelGuardInPage, true))
    run(pageScript(humanInteractionWheelGuardInPage, true))
    expect(wheel()).toBe(false)
    run(pageScript(humanInteractionWheelGuardInPage, false))
    expect(wheel()).toBe(true)
    expect('__hronautHumanInteractionWheelGuard' in globalThis).toBe(false)
  })

  it('records local and session storage by key, with a fingerprint, size and start of each value', () => {
    localStorage.setItem('b', 'été')
    localStorage.setItem('a', 'x'.repeat(10))
    localStorage.setItem('c', '')
    sessionStorage.setItem('tab', 'one')
    const snapshot = run<ReturnType<typeof storageSnapshotInPage>>(pageScript(storageSnapshotInPage, 2, 4))
    expect(snapshot.local.itemCount).toBe(3)
    expect(snapshot.local.entries.map(entry => [entry.key, entry.valueBytes, entry.valuePreview])).toEqual([['a', 10, 'xxxx'], ['b', 5, 'été']])
    expect(snapshot.local.entries[0]!.fingerprint).toMatch(/^\d+:\d+:10$/u)
    expect(snapshot.local.entries[0]!.fingerprint).not.toBe(snapshot.local.entries[1]!.fingerprint)
    expect(snapshot.session).toEqual({ itemCount: 1, entries: [expect.objectContaining({ key: 'tab', valueBytes: 3, valuePreview: 'one' })] })
  })

  it('reads, sets, deletes and clears web storage on the page it was asked about, and on no other', () => {
    const href = location.href
    expect(run(pageScript(webStorageInPage, `${href}#other`, 'localStorage', 'list', undefined, undefined))).toEqual({ pageChanged: true })
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'set', 'b', '2'))).toEqual({ changed: true, itemCount: 1, items: [['b', '2']] })
    localStorage.setItem('a', '1')
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'list', undefined, undefined))).toEqual({ changed: false, itemCount: 2, items: [['a', '1'], ['b', '2']] })
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'get', 'a', undefined))).toEqual({ changed: false, itemCount: 2, items: [['a', '1']] })
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'delete', 'missing', undefined))).toMatchObject({ changed: false, itemCount: 2 })
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'delete', 'a', undefined))).toEqual({ changed: true, itemCount: 1, items: [['b', '2']] })
    expect(run(pageScript(webStorageInPage, href, 'sessionStorage', 'clear', undefined, undefined))).toEqual({ changed: false, itemCount: 0, items: [] })
    expect(run(pageScript(webStorageInPage, href, 'localStorage', 'clear', undefined, undefined))).toEqual({ changed: true, itemCount: 0, items: [] })
  })

  it('gives the storage manager\'s estimate, or null when the page has none or it fails', async () => {
    stub(navigator, 'storage', undefined)
    await expect(run<Promise<unknown>>(pageScript(storageEstimateInPage))).resolves.toBeNull()
    stub(navigator, 'storage', { estimate: async () => ({ usage: 10, quota: 100, usageDetails: { indexedDB: 10 }, extra: true }) })
    await expect(run<Promise<unknown>>(pageScript(storageEstimateInPage))).resolves.toEqual({ usage: 10, quota: 100, usageDetails: { indexedDB: 10 } })
    stub(navigator, 'storage', { estimate: async () => { throw new Error('denied') } })
    await expect(run<Promise<unknown>>(pageScript(storageEstimateInPage))).resolves.toBeNull()
  })
})
