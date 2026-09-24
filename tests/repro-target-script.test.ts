// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { reproTargetScript } from '../src/main/browser/page-scripts.js'
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
})
