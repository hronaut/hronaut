// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { reproTargetScript } from '../src/main/browser/repro-page-scripts.js'
import type { BrowserReproTarget } from '../src/shared/types.js'

function capture(element: HTMLElement): BrowserReproTarget {
  element.focus()
  return window.eval(reproTargetScript()) as BrowserReproTarget
}

afterEach(() => { document.body.replaceChildren() })

describe('reproduction target selectors', () => {
  it('distinguishes identical controls beneath more than seven repeated ancestors', () => {
    const nested = `${'<div>'.repeat(9)}<button>Continue</button>${'</div>'.repeat(9)}`
    document.body.innerHTML = `<section>${nested}</section><section>${nested}</section>`
    const selected = document.querySelectorAll('button')[1]
    if (!selected) throw new Error('Repeated target fixture is missing')
    const target = capture(selected)
    expect([...document.querySelectorAll(target.selector)]).toEqual([selected])
  })

  it('keeps an unresolvable long path explicit instead of slicing CSS', () => {
    const name = `custom-${'a'.repeat(510)}`
    const element = document.createElement(name)
    element.tabIndex = 0
    document.body.append(element)
    const target = capture(element)
    expect(target.tag).toBeTruthy()
    expect(target.selector).toBe('')
  })
  it('retains a focused shadow input as a manual target rather than exporting its host', () => {
    const host = document.createElement('custom-input')
    document.body.append(host)
    const root = host.attachShadow({ mode: 'open' })
    root.innerHTML = '<input aria-label="Search">'
    const target = capture(root.querySelector('input')!)
    expect(target).toMatchObject({ selector: '', tag: 'input', inputType: 'text' })
  })

  it('retains frame focus as a manual target rather than exporting the iframe element', () => {
    const frame = document.createElement('iframe')
    document.body.append(frame)
    const target = capture(frame)
    expect(target).toMatchObject({ selector: '', tag: 'iframe' })
  })

  it('keeps light-DOM controls assigned to a shadow slot exportable', () => {
    const host = document.createElement('custom-slot')
    host.attachShadow({ mode: 'open' }).innerHTML = '<slot></slot>'
    host.innerHTML = '<button>Continue</button>'
    document.body.append(host)
    const button = host.querySelector('button')!
    const target = capture(button)
    expect([...document.querySelectorAll(target.selector)]).toEqual([button])
  })

  it('keeps a deliberately focused host distinct from a focused shadow descendant', () => {
    const host = document.createElement('custom-control')
    host.tabIndex = 0
    host.attachShadow({ mode: 'open' }).innerHTML = '<input>'
    document.body.append(host)
    const target = capture(host)
    expect([...document.querySelectorAll(target.selector)]).toEqual([host])
  })

})

describe('reproduction target text privacy', () => {
  it.each(['true', '', 'plaintext-only', 'TRUE', 'PLAINTEXT-ONLY'])('excludes %s editor text and nested targets without mutating the page', editable => {
    document.body.innerHTML = `<div id="editor" tabindex="0" contenteditable="${editable}"><span id="child" tabindex="0">draft-canary</span><span id="readonly" tabindex="0" contenteditable="false">draft-readonly-canary</span></div>`
    const original = document.body.innerHTML
    for (const selector of ['#editor', '#child', '#readonly']) {
      const element = document.querySelector<HTMLElement>(selector)!
      const target = capture(element)
      expect(target.label).toBeUndefined()
      expect(document.querySelector(target.selector)).toBe(element)
    }
    expect(document.body.innerHTML).toBe(original)
  })

  it('preserves public text around editor and native-control subtrees, including associated labels', () => {
    document.body.innerHTML = '<section tabindex="0">Public heading <span contenteditable="true">draft-rich-canary</span> Public ending<textarea>draft-native-canary</textarea><select><option>draft-option-canary</option></select></section><label for="input">Account <span contenteditable="plaintext-only">draft-label-canary</span><textarea>draft-label-native-canary</textarea></label><input id="input" value="draft-input-canary">'
    const original = document.body.innerHTML
    expect(capture(document.querySelector('section')!).label).toBe('Public heading Public ending')
    expect(capture(document.querySelector('input')!).label).toBe('Account')
    expect(document.body.innerHTML).toBe(original)
  })

  it('retains explicit public metadata, native placeholders and ordinary readonly text', () => {
    document.body.innerHTML = '<div tabindex="0" contenteditable="true" aria-label="Public editor">draft-canary</div><input placeholder="Public input" value="draft-canary"><textarea placeholder="Public notes">draft-canary</textarea><select aria-label="Public choice"><option>draft-canary</option></select><button title="Public title">Action</button><p tabindex="0" contenteditable="false">Public readonly</p>'
    const labels = [...document.body.children].map(element => capture(element as HTMLElement).label)
    expect(labels).toEqual(['Public editor', 'Public input', 'Public notes', 'Public choice', 'Public title', 'Public readonly'])
  })

  it('retains public labels after long formatting whitespace around excluded drafts', () => {
    document.body.innerHTML = `<label for="input">${' '.repeat(200)}Public account<span contenteditable="true">draft-canary</span></label><input id="input"><section tabindex="0">${'\n '.repeat(200)}Public heading<span contenteditable="plaintext-only">draft-canary</span></section>`
    expect(capture(document.querySelector('input')!).label).toBe('Public account')
    expect(capture(document.querySelector('section')!).label).toBe('Public heading')
  })

  it('filters fresh captures after a previously public subtree becomes editable', () => {
    document.body.innerHTML = '<section tabindex="0">Public neighbor <span>Public text</span></section>'
    const target = document.querySelector('section')!
    expect(capture(target).label).toBe('Public neighbor Public text')
    target.querySelector('span')!.setAttribute('contenteditable', 'true')
    target.querySelector('span')!.textContent = 'draft-later-canary'
    expect(capture(target).label).toBe('Public neighbor')
  })

  it('keeps filtered output bounded without falling back to raw text after traversal limits', () => {
    document.body.innerHTML = `<section tabindex="0">Public ${'<div>'.repeat(110)}<span contenteditable="true">draft-deep-canary</span>${'</div>'.repeat(110)}${'<span>safe </span>'.repeat(5100)}<span contenteditable="plaintext-only">draft-late-canary</span></section>`
    const target = capture(document.querySelector('section')!)
    expect(target.label).toContain('Public')
    expect(target.label!.length).toBeLessThanOrEqual(180)
    expect(JSON.stringify(target)).not.toContain('draft-')
  })
})
