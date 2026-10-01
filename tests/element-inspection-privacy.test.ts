// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cancelElementPickerScript, elementInspectionScript, elementPickerInspectionAtPointScript, elementPickerNativeInputScript, elementPickerScript, playwrightLocatorScript } from '../src/main/browser/page-scripts.js'

function fixture() {
  document.body.innerHTML = '<main id="group"><p>Public neighbor</p><div id="editor" contenteditable="true" role="textbox"><span id="child">private-rich-canary</span></div><textarea>private-native-canary</textarea><button id="labelled" aria-labelledby="editor">Public button</button><label for="input">Account <span contenteditable="plaintext-only">private-label-canary</span></label><input id="input"></main>'
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 30, x: 0, y: 0 } as DOMRect)
}
afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })

it.each(['#editor', '#child', '#group', '#labelled', '#input'])('omits editable values from inspection and names for %s without mutating evidence', selector => {
  fixture()
  const original = document.body.innerHTML
  const report = window.eval(elementInspectionScript({ selector }))
  expect(JSON.stringify(report)).not.toMatch(/private-(rich|native|label)-canary/)
  expect(report.box.width).toBe(100)
  if (selector === '#group') expect(report.text).toContain('Public neighbor')
  if (selector === '#input') expect(report.accessibility.name).toBe('Account')
  expect(document.body.innerHTML).toBe(original)
})

it('applies the same exclusion to point-picked inspection', () => {
  fixture()
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => document.querySelector('#editor') })
  const report = window.eval(elementPickerInspectionAtPointScript(1, 1, 100, 100))
  expect(JSON.stringify(report)).not.toContain('private-rich-canary')
})

it('never embeds filtered names in generated semantic locators', () => {
  fixture()
  for (const selector of ['#editor', '#labelled', '#input']) {
    const result = window.eval(playwrightLocatorScript({ selector }))
    expect(JSON.stringify(result)).not.toMatch(/private-(rich|native|label)-canary/)
    expect(result.candidates.filter((candidate: { strategy: string }) => ['role', 'label'].includes(candidate.strategy))).toEqual([])
    expect(result.selector).toBe(selector)
  }
})

it('preserves an ordinary public role locator next to an unrelated editor', () => {
  fixture()
  document.body.innerHTML = '<button id="save">Save changes</button><div contenteditable="true" role="textbox">private-rich-canary</div>'
  const result = window.eval(playwrightLocatorScript({ selector: '#save' }))
  expect(result.candidates).toContainEqual({ strategy: 'role', role: 'button', value: 'Save changes' })
})


it('rechecks a live picker subtree after a new editor is inserted', async () => {
  fixture()
  document.body.innerHTML = '<section id="live">Public live label</section>'
  const target = document.querySelector('#live')!
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => target })
  const pending = window.eval(elementPickerScript())
  try {
    window.eval(elementPickerNativeInputScript('move', 1, 1, 100, 100))
    expect(document.querySelector('[data-hronaut-element-picker="label"]')!.textContent).toContain('Public live label')
    target.insertAdjacentHTML('beforeend', '<span contenteditable="true">private-late-canary</span>')
    window.eval(elementPickerNativeInputScript('move', 1, 1, 100, 100))
    expect(document.querySelector('[data-hronaut-element-picker="label"]')!.textContent).not.toContain('private-late-canary')
    expect(target.textContent).toContain('private-late-canary')
  } finally {
    window.eval(cancelElementPickerScript())
    await expect(pending).resolves.toEqual({ canceled: true })
  }
})
