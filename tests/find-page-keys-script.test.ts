// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

const { clearFocusScript } = await import('../src/main/browser/page-find/find-page-keys.js')
afterEach(() => { document.body.replaceChildren() })

describe('the script unfocusing the page\'s element for a key from the Find field', () => {
  const run = (deadline: number) => (0, eval)(clearFocusScript(deadline)) as unknown

  it('unfocuses the focused element, which keeps its text and caret', () => {
    document.body.innerHTML = '<textarea>first line</textarea>'
    const field = document.querySelector('textarea')!
    field.focus()
    field.setSelectionRange(5, 5)
    run(Date.now() + 300)
    expect(document.activeElement).toBe(document.body)
    expect([field.value, field.selectionStart]).toEqual(['first line', 5])
  })

  it('does nothing once its deadline passed, as the key went without it', () => {
    document.body.innerHTML = '<textarea>first line</textarea>'
    const field = document.querySelector('textarea')!
    field.focus()
    run(Date.now() - 1)
    expect(document.activeElement).toBe(field)
  })

  it('leaves a frame it cannot reach into focused', () => {
    document.body.innerHTML = '<iframe></iframe>'
    const frame = document.querySelector('iframe')!
    // A frame from another site, whose document the page cannot read.
    Object.defineProperty(frame, 'contentDocument', { value: null })
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => frame })
    const blur = vi.spyOn(frame, 'blur')
    try {
      run(Date.now() + 300)
      expect(blur).not.toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(document, 'activeElement')
    }
  })
})
