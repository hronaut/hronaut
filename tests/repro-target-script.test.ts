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
