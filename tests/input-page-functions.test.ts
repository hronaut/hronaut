// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fileDropDisposeScript, fileDropLocateScript } from '../src/main/browser/file-drop/file-drop-scripts.js'
import { nativeClickReceiverInPage, nativeClickSampleInPage, type NativeClickTarget } from '../src/main/browser/native-click-admission.page.js'
import { nativeClickTargetScript } from '../src/main/browser/native-click-admission.js'
import { textFileFillCheckScript, textFileFillScript } from '../src/main/browser/text-file-fill/text-file-fill-scripts.js'
import { textInsertionDisposeScript, textInsertionLocateScript } from '../src/main/browser/text-insertion/text-insertion-scripts.js'

// The input scripts are built from page functions; these run them as main sends them, in a page.

const run = (script: string): unknown => window.eval(script) as unknown
const box = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height } as DOMRect)
const cleanups: Array<() => void> = []

/** Sets a property jsdom may not have, such as scrollIntoView, and puts back what was there after the test. */
function stub(owner: object, name: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(owner, name)
  Object.defineProperty(owner, name, { configurable: true, writable: true, value })
  cleanups.push(() => { if (own) Object.defineProperty(owner, name, own); else delete (owner as Record<string, unknown>)[name] })
}

beforeEach(() => {
  stub(Element.prototype, 'scrollIntoView', () => undefined)
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(10, 20, 100, 40))
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('text file fill in a page', () => {
  const shape = (length: number, lineBreaks = false) => ({ length, lineBreaks })

  it('checks the target for text of this shape', () => {
    document.body.innerHTML = '<input id="name"><input id="number" type="number"><textarea id="notes" maxlength="5"></textarea>'
      + '<input id="off" disabled><input id="locked" readonly>'
    const origin = location.origin
    expect(run(textFileFillCheckScript({ selector: '#name' }, shape(3), origin))).toEqual({ field: 'input' })
    expect(run(textFileFillCheckScript({ selector: '#notes' }, shape(5, true), origin))).toEqual({ field: 'textarea' })
    expect(run(textFileFillCheckScript({ selector: '#name' }, shape(3), 'https://elsewhere.test'))).toEqual({ problem: 'wrong-origin' })
    expect(run(textFileFillCheckScript({ selector: '#missing' }, shape(3), origin))).toEqual({ problem: 'not-found' })
    expect(run(textFileFillCheckScript({ selector: 'input' }, shape(3), origin))).toEqual({ problem: 'ambiguous' })
    expect(run(textFileFillCheckScript({ selector: '#number' }, shape(3), origin))).toEqual({ problem: 'not-fillable' })
    expect(run(textFileFillCheckScript({ selector: '#off' }, shape(3), origin))).toEqual({ problem: 'disabled' })
    expect(run(textFileFillCheckScript({ selector: '#locked' }, shape(3), origin))).toEqual({ problem: 'readonly' })
    expect(run(textFileFillCheckScript({ selector: '#name' }, shape(3, true), origin))).toEqual({ problem: 'single-line' })
    expect(run(textFileFillCheckScript({ selector: '#notes' }, shape(6), origin))).toEqual({ problem: 'too-long' })
  })

  it('writes the text once it starts in time, and reports a page that rewrites it', async () => {
    document.body.innerHTML = '<textarea id="notes"></textarea><input id="masked">'
    document.getElementById('masked')!.addEventListener('input', event => { (event.target as HTMLInputElement).value = 'masked' })
    const later = Date.now() + 5_000
    await expect(run(textFileFillScript({ selector: '#notes' }, 'one\ntwo', location.origin, later))).resolves.toEqual({
      field: 'textarea', matched: true, connected: true, fieldCharacters: 7
    })
    expect((document.getElementById('notes') as HTMLTextAreaElement).value).toBe('one\ntwo')
    await expect(run(textFileFillScript({ selector: '#masked' }, 'abc', location.origin, later))).resolves.toEqual({
      field: 'input', matched: false, connected: true, fieldCharacters: 6
    })
    await expect(run(textFileFillScript({ selector: '#notes' }, 'x', location.origin, Date.now() - 1))).resolves.toEqual({ problem: 'late' })
  })
})

describe('text insertion in a page', () => {
  const text = (length: number, lineBreaks = false) => ({ length, lineBreaks })

  it('records the focused editor and refuses one that cannot take the text', () => {
    document.body.innerHTML = '<input id="name" maxlength="4" value="ab"><textarea id="notes"></textarea>'
    const name = document.getElementById('name') as HTMLInputElement
    expect(run(textInsertionLocateScript({ selector: '#name' }, 'unfocused', 'check', text(1)))).toEqual({ problem: 'not-focused' })
    name.focus()
    expect(run(textInsertionLocateScript({ selector: '#name' }, 'lines', 'check', text(1, true)))).toEqual({ problem: 'single-line' })
    expect(run(textInsertionLocateScript({ selector: '#name' }, 'long', 'check', text(3)))).toEqual({ problem: 'too-long' })
    expect(run(textInsertionLocateScript({ selector: '#name' }, 'fits', 'check', text(2)))).toEqual({ editor: 'input' })
    expect(run(textInsertionLocateScript({ selector: '#notes' }, 'fits', 'arm', text(2)))).toEqual({ problem: 'replaced' })
    expect(run(textInsertionLocateScript({ selector: '#missing' }, 'fits', 'check', text(2)))).toEqual({ problem: 'not-found' })
    for (const token of ['unfocused', 'lines', 'long', 'fits']) expect(run(textInsertionDisposeScript(token))).toBe(true)
  })

  it('arms the guard, which cancels text aimed elsewhere until it is disposed', () => {
    document.body.innerHTML = '<textarea id="notes"></textarea><input id="other">'
    document.getElementById('notes')!.focus()
    expect(run(textInsertionLocateScript({ selector: '#notes' }, 'armed', 'check', text(1)))).toEqual({ editor: 'textarea' })
    expect(run(textInsertionLocateScript({ selector: '#notes' }, 'armed', 'arm', text(1)))).toEqual({ editor: 'textarea' })
    // A trusted event cannot be made in a test; an untrusted one is left alone, as the page's own events are.
    const elsewhere = new InputEvent('beforeinput', { inputType: 'insertText', data: 'x', cancelable: true })
    document.getElementById('other')!.dispatchEvent(elsewhere)
    expect(elsewhere.defaultPrevented).toBe(false)
    expect(run(textInsertionDisposeScript('armed'))).toBe(true)
    expect((globalThis as { __hronautTextInsertions?: Map<string, unknown> }).__hronautTextInsertions?.has('armed')).toBe(false)
  })
})

describe('file drop in a page', () => {
  it('returns the target\'s center when nothing covers it, and refuses a covered target or a frame', () => {
    document.body.innerHTML = '<div id="zone"><span id="inside"></span></div><div id="cover"></div><iframe id="frame"></iframe>'
    const hit = vi.fn<(x: number, y: number) => Element | null>(() => document.getElementById('inside'))
    stub(document, 'elementFromPoint', hit)
    expect(run(fileDropLocateScript({ selector: '#zone' }, 'drop', true))).toEqual({ x: 60, y: 40 })
    expect(hit).toHaveBeenCalledWith(60, 40)
    expect(run(fileDropLocateScript({ selector: '#zone' }, 'drop', false))).toEqual({ x: 60, y: 40 })
    expect(run(fileDropLocateScript({ selector: '#cover' }, 'drop', false))).toEqual({ problem: 'replaced' })
    hit.mockReturnValue(document.getElementById('cover'))
    expect(run(fileDropLocateScript({ selector: '#zone' }, 'drop', false))).toEqual({ problem: 'covered' })
    expect(run(fileDropLocateScript({ selector: '#frame' }, 'frame', true))).toEqual({ problem: 'frame' })
    expect(run(fileDropDisposeScript('drop'))).toBe(true)
    expect((globalThis as { __hronautFileDrops?: Map<string, unknown> }).__hronautFileDrops?.has('drop')).toBe(false)
  })
})

describe('native click admission in a page', () => {
  it('admits a point that hits the target, and names what changed otherwise', () => {
    document.body.innerHTML = '<button id="go"><b id="label">Go</b></button><div id="cover"></div>'
    const hit = vi.fn<(x: number, y: number) => Element | null>(() => document.getElementById('label'))
    // The admission reads the isolated realm's own Document.prototype.elementFromPoint, which jsdom lacks.
    stub(Document.prototype, 'elementFromPoint', hit)
    const admission = run(nativeClickTargetScript({ selector: '#go' })) as NativeClickTarget
    expect(nativeClickSampleInPage.call(admission, 5, 5, false)).toBe('ADMITTED')
    expect(nativeClickReceiverInPage.call(admission)).toBe(document.getElementById('label'))
    expect(nativeClickSampleInPage.call(admission, 5, 5, true)).toBe('ADMITTED')
    expect(admission.sample(-1, 5, true)).toBe('POINT_OUTSIDE_VIEWPORT')
    hit.mockReturnValue(document.getElementById('go'))
    expect(admission.sample(5, 5, true)).toBe('HIT_CHANGED')
    hit.mockReturnValue(document.getElementById('cover'))
    expect(admission.sample(5, 5, false)).toBe('TARGET_OCCLUDED')
    document.getElementById('go')!.setAttribute('disabled', '')
    expect(admission.sample(5, 5, false)).toBe('TARGET_DISABLED')
    document.getElementById('go')!.remove()
    expect(admission.sample(5, 5, false)).toBe('TARGET_CHANGED')
    expect(() => run(nativeClickTargetScript({ selector: '#missing' }))).toThrow('TARGET_UNAVAILABLE')
  })
})
