// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dialogAwareClickScript,
  dialogAwareCoordinateClickScript,
  dialogAwareEvaluateScript,
  dragPointsScript,
  targetActionScript,
  targetExpression,
  targetPointScript,
  targetStateScript
} from '../src/main/browser/page-scripts.js'
import { multiSelectScript } from '../src/main/browser/semantic-multi-select.js'

// The target action scripts are built from page functions; these run them as main sends them, in a page.

const run = (script: string): unknown => window.eval(script) as unknown
const box = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height } as DOMRect)
const cleanups: Array<() => void> = []
const scrollIntoView = vi.fn<(this: Element) => void>()

/** Sets a property jsdom may not have, such as scrollIntoView, and puts back what was there after the test. */
function stub(owner: object, name: string, value: unknown): void {
  const own = Object.getOwnPropertyDescriptor(owner, name)
  Object.defineProperty(owner, name, { configurable: true, writable: true, value })
  cleanups.push(() => { if (own) Object.defineProperty(owner, name, own); else delete (owner as Record<string, unknown>)[name] })
}

function listen(type: string, listener: (event: Event) => void, target: EventTarget = document): void {
  target.addEventListener(type, listener, true)
  cleanups.push(() => target.removeEventListener(type, listener, true))
}

beforeEach(() => { stub(Element.prototype, 'scrollIntoView', scrollIntoView) })
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
  scrollIntoView.mockReset()
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('target actions in a page', () => {
  it('finds the element a ref or selector names', () => {
    document.body.innerHTML = '<p data-hronaut-ref="e1" id="by-ref"></p><p id="by-selector"></p>'
    expect((run(targetExpression({ ref: 'e1' })) as Element).id).toBe('by-ref')
    expect((run(targetExpression({ selector: '#by-selector' })) as Element).id).toBe('by-selector')
    expect(run(targetExpression({}))).toBeNull()
  })

  it('clicks an enabled element and returns a marker for a natively disabled one without clicking it', () => {
    document.body.innerHTML = '<button id="on">On</button><button id="off" disabled>Off</button>'
    const clicks: string[] = []
    listen('click', event => clicks.push((event.target as Element).id))
    expect(run(targetActionScript('click', { selector: '#on' }))).toEqual({ ok: true, tag: 'button' })
    expect(run(targetActionScript('click', { selector: '#off' }))).toEqual({ nativeDisabled: true })
    expect(clicks).toEqual(['on'])
    expect(() => run(targetActionScript('click', { selector: '#missing' }))).toThrow('Element not found')
  })

  it('chooses an option by value, label or text, and refuses a disabled select', () => {
    document.body.innerHTML = '<select id="pick"><option value="a">Alpha</option><option value="b" label="Beta">B</option></select>'
      + '<select id="locked" disabled><option value="a">Alpha</option></select>'
    const seen: string[] = []
    for (const kind of ['input', 'change']) listen(kind, event => seen.push(event.type))
    expect(run(targetActionScript('select', { selector: '#pick' }, 'Beta'))).toEqual({ ok: true, tag: 'select', value: 'b', label: 'Beta' })
    expect((document.getElementById('pick') as HTMLSelectElement).value).toBe('b')
    expect(seen).toEqual(['input', 'change'])
    expect(run(targetActionScript('select', { selector: '#locked' }, 'a'))).toEqual({ nativeEditability: 'disabled' })
    expect(() => run(targetActionScript('select', { selector: '#pick' }, 'Gamma'))).toThrow('Select option not found: Gamma')
  })

  it('answers dialogs during a click as asked and gives the page its own dialogs back', () => {
    document.body.innerHTML = '<button id="ask">Ask</button>'
    const answers: unknown[] = []
    listen('click', () => answers.push(window.confirm('sure?'), window.prompt('name?', 'fallback')), document.getElementById('ask')!)
    const own = { confirm: window.confirm, prompt: window.prompt }
    expect(run(dialogAwareClickScript({ selector: '#ask' }, 'accept', 'typed'))).toEqual({ ok: true, tag: 'button' })
    expect(run(dialogAwareClickScript({ selector: '#ask' }, 'accept'))).toEqual({ ok: true, tag: 'button' })
    expect(run(dialogAwareClickScript({ selector: '#ask' }, 'dismiss', 'typed'))).toEqual({ ok: true, tag: 'button' })
    expect(answers).toEqual([true, 'typed', true, 'fallback', false, null])
    expect({ confirm: window.confirm, prompt: window.prompt }).toEqual(own)
  })

  it('dispatches a click at a point with dialogs answered, and refuses a point with no element', () => {
    document.body.innerHTML = '<a id="link">Link</a>'
    const link = document.getElementById('link')!
    stub(document, 'elementFromPoint', () => link)
    // jsdom's MouseEvent refuses the test environment's window as its view; Chromium takes the page's window.
    const NativeMouseEvent = MouseEvent
    stub(globalThis, 'MouseEvent', class extends NativeMouseEvent { constructor(type: string, init?: MouseEventInit) { super(type, { ...init, view: null }) } })
    const clicks: Array<[number, number, unknown]> = []
    listen('click', event => clicks.push([(event as MouseEvent).clientX, (event as MouseEvent).clientY, window.confirm('go?')]), link)
    const own = window.confirm
    expect(run(dialogAwareCoordinateClickScript({ x: 12, y: 34 }, 'accept'))).toEqual({ ok: true, tag: 'a', x: 12, y: 34 })
    expect(clicks).toEqual([[12, 34, true]])
    expect(window.confirm).toBe(own)
    stub(document, 'elementFromPoint', () => null)
    expect(() => run(dialogAwareCoordinateClickScript({ x: 1, y: 1 }, 'dismiss'))).toThrow('No element exists at the requested viewport coordinates.')
    expect(window.confirm).toBe(own)
  })

  it('evaluates a script in the page\'s global scope, not the page function\'s', async () => {
    cleanups.push(() => { delete (globalThis as Record<string, unknown>).__hronautEvaluated })
    expect(await run(dialogAwareEvaluateScript('var __hronautEvaluated = typeof releaseDialogs + typeof accept; __hronautEvaluated', 'accept', 'scope'))).toBe('undefinedundefined')
    expect((globalThis as Record<string, unknown>).__hronautEvaluated).toBe('undefinedundefined')
  })

  it('reports whether a target is attached, detached, visible or hidden', () => {
    document.body.innerHTML = '<div id="shown">x</div><div id="none" style="display: none">x</div>'
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(0, 0, 10, 10))
    expect(run(targetStateScript({ selector: '#shown' }, 'attached'))).toEqual({ matches: true })
    expect(run(targetStateScript({ selector: '#shown' }, 'visible'))).toEqual({ matches: true })
    expect(run(targetStateScript({ selector: '#none' }, 'hidden'))).toEqual({ matches: true })
    expect(run(targetStateScript({ selector: '#missing' }, 'detached'))).toEqual({ matches: true })
    expect(run(targetStateScript({ selector: '#missing' }, 'visible'))).toEqual({ matches: false })
  })

  it('measures a target\'s center, refusing a disabled one only when asked and one without bounds always', () => {
    document.body.innerHTML = '<button id="off" disabled>Off</button><span id="flat"></span>'
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(box(10, 20, 100, 40))
    expect(run(targetPointScript({ selector: '#off' }))).toEqual({ x: 60, y: 40, tag: 'button' })
    expect(run(targetPointScript({ selector: '#off' }, { rejectNativeDisabled: true }))).toEqual({ nativeDisabled: true })
    rect.mockReturnValue(box(0, 0, 0, 0))
    expect(() => run(targetPointScript({ selector: '#flat' }))).toThrow('Element has no visible bounds.')
  })

  it('measures a drag\'s source and destination after scrolling both into view', () => {
    document.body.innerHTML = '<div id="from"></div><div id="to"></div>'
    const order: string[] = []
    scrollIntoView.mockImplementation(function (this: Element) { order.push(`scroll ${this.id}`) })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      order.push(`measure ${this.id}`)
      return this.id === 'from' ? box(0, 0, 20, 20) : box(100, 200, 40, 40)
    })
    expect(run(dragPointsScript({ selector: '#from' }, { selector: '#to' }))).toEqual({
      from: { x: 10, y: 10, tag: 'div' },
      to: { x: 120, y: 220, tag: 'div' }
    })
    expect(order).toEqual(['scroll from', 'scroll to', 'measure from', 'measure to'])
    expect(() => run(dragPointsScript({ selector: '#from' }, { selector: '#missing' }))).toThrow('Element not found')
  })
})

describe('semantic multi-select in a page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<select id="many" multiple><option value="a" selected>A</option><option value="b">B</option>'
      + '<optgroup disabled><option value="c">C</option></optgroup><option value="d">D</option></select>'
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([box(0, 0, 10, 10)] as unknown as DOMRectList)
  })
  const selected = (): string[] => [...(document.getElementById('many') as HTMLSelectElement).selectedOptions].map(option => option.value)

  it('selects exactly the requested values', () => {
    expect(run(multiSelectScript({ selector: '#many' }, ['b', 'd']))).toEqual({
      ok: true, status: 'SELECTED', semantic: true, selectedCount: 2, observed: 'immediate-native-state', retrySafe: false
    })
    expect(selected()).toEqual(['b', 'd'])
  })

  it('refuses a disabled, missing or not-multiple choice before changing anything', () => {
    const rejected = (reason: string) => ({ ok: false, status: 'REJECTED', effects: 'none', retrySafe: false, reason })
    expect(run(multiSelectScript({ selector: '#many' }, ['c']))).toEqual(rejected('Requested option or option group is disabled'))
    expect(run(multiSelectScript({ selector: '#many' }, ['z']))).toEqual(rejected('Requested value is missing or ambiguous'))
    expect(run(multiSelectScript({ selector: '#nothing' }, ['a']))).toEqual(rejected('Target must identify exactly one element'))
    expect(run(multiSelectScript({ selector: '[' }, ['a']))).toEqual(rejected('Invalid target selector'))
    expect(selected()).toEqual(['a'])
  })

  it('reports an outcome it cannot confirm when a handler changes the selection', () => {
    listen('input', () => { (document.querySelector('option[value="a"]') as HTMLOptionElement).selected = true }, document.getElementById('many')!)
    expect(run(multiSelectScript({ selector: '#many' }, ['b']))).toMatchObject({ ok: false, status: 'OUTCOME_UNKNOWN', effects: 'possible' })
  })
})
