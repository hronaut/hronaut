// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { textBoundInPage } from '../src/main/browser/computed-accessibility/computed-accessibility.page.js'

const count = (element: Element, maxChars = 1_000, maxElements = 100) => textBoundInPage.call(element as never, maxChars, maxElements)

describe('computed accessibility text bound', () => {
  // jsdom has no generated content; the target's ::before carries "ab" here, which counts with its quotes.
  beforeEach(() => vi.stubGlobal('getComputedStyle', (element: Element, pseudo?: string) => ({ content: element.id === 'target' && pseudo === '::before' ? '"ab"' : 'none' })))
  afterEach(() => vi.unstubAllGlobals())

  it('counts the subtree, attributes but class and style, form values, labels and referenced elements once', () => {
    document.body.innerHTML = '<span id="hint">abcd</span><label for="field">Name</label>'
      + '<div id="target" class="ignored-class" style="color: red" title="xy" aria-describedby="hint hint"><b>12345</b><input id="field" value="vvv"></div>'
    // The div's id, title and aria-describedby (6 + 2 + 9) and generated content (4), the bold text (5), the input's id
    // and value attributes and its value (5 + 3 + 3), and the described span once, its id and text (4 + 4).
    expect(count(document.getElementById('target')!)).toEqual({ chars: 21 + 5 + 11 + 8, elements: 4 })
    // A field's own labels count too: the input (11) and its label's for attribute and text (5 + 4).
    expect(count(document.getElementById('field')!)).toEqual({ chars: 11 + 9, elements: 2 })
  })

  it('enters open shadow roots and stops once a limit is passed', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const host = document.getElementById('host')!
    host.attachShadow({ mode: 'open' }).innerHTML = '<p>shadow text</p>'
    expect(count(host)).toEqual({ chars: 4 + 11, elements: 2 })
    document.body.innerHTML = `<div id="many">${'<i>x</i>'.repeat(20)}</div>`
    expect(count(document.getElementById('many')!, 1_000, 3).elements).toBe(4)
  })
})
