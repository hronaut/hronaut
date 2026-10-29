// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { credentialFillContext } from '../src/main/browser/credential-fill-context.js'
import { suggestedPasswordFieldScript, suggestedPasswordFillScript } from '../src/main/browser/suggested-password/suggested-password-page.js'

const PASSWORD = 'k7Gm2xPqR9sTv4w'
const realClientRects = Element.prototype.getClientRects

function context(url = location.href) {
  return credentialFillContext(url, 1, 1)!
}

/** Keeps the focused field and reads its limits, as the right-click's menu item does first. */
function field(url?: string): unknown {
  return window.eval(suggestedPasswordFieldScript(context(url)))
}

function fill(password = PASSWORD, url?: string): unknown {
  return window.eval(suggestedPasswordFillScript(context(url), password))
}

/** Focuses the field, keeps it, and fills it. */
function suggestIn(selector: string, password = PASSWORD): unknown {
  input(selector).focus()
  field()
  return fill(password)
}

function input(selector: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(selector)!
}

beforeEach(() => {
  // jsdom lays nothing out: a field shows unless it, or a box around it, is not displayed.
  Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[style*="display:none"]') ? [] : [{ width: 120, height: 24 }]) as unknown as DOMRectList
  }
})

afterEach(() => {
  Element.prototype.getClientRects = realClientRects
  document.body.innerHTML = ''
})

describe('reading the password field a password is suggested for', () => {
  it('reads the length limits of the focused password field and its confirmation, -1 where they set none', () => {
    document.body.innerHTML = '<form><input id="new" type="password" minlength="20" maxlength="64"><input id="confirm" type="password" maxlength="40"></form><input id="plain" type="password">'
    input('#new').focus()
    expect(field()).toEqual({ minLength: 20, maxLength: 40 })
    input('#plain').focus()
    expect(field()).toEqual({ minLength: -1, maxLength: -1 })
  })

  it('finds nothing in a field that is no writable password field, or on another page', () => {
    document.body.innerHTML = '<input id="text"><input id="fixed" type="password" readonly><input id="pw" type="password">'
    input('#text').focus()
    expect(field()).toBeNull()
    input('#fixed').focus()
    expect(field()).toBeNull()
    input('#pw').focus()
    expect(field('https://elsewhere.example/')).toBeNull()
    input('#pw').blur()
    expect(field()).toBeNull()
  })

  it('suggests nothing in a shadow root, whose form Hronaut could not see submitted', () => {
    document.body.innerHTML = '<sign-up-form></sign-up-form>'
    const root = document.querySelector('sign-up-form')!.attachShadow({ mode: 'open' })
    root.innerHTML = '<input type="password">'
    root.querySelector('input')!.focus()
    expect(field()).toBeNull()
    expect(fill()).toBe('none')
    expect(root.querySelector('input')!.value).toBe('')
  })
})

describe('filling a suggested password', () => {
  it('fills the field it kept and the one confirming it, as typing would', () => {
    document.body.innerHTML = '<form><input id="email" type="email"><input id="new" type="password"><input id="confirm" type="password"><input id="code" type="text"></form>'
    const changes: string[] = []
    for (const type of ['input', 'change']) input('#confirm').addEventListener(type, (event) => changes.push(`${type}${event.bubbles ? ' bubbles' : ''}`))
    expect(suggestIn('#new')).toBe('filled')
    expect(input('#new').value).toBe(PASSWORD)
    expect(input('#confirm').value).toBe(PASSWORD)
    expect(input('#email').value).toBe('')
    expect(changes).toEqual(['input bubbles', 'change bubbles'])
    expect(document.activeElement).toBe(input('#new'))
  })

  it('fills only the field the menu was for, while it still has the focus', () => {
    document.body.innerHTML = '<form><input id="current" type="password"></form><form><input id="new" type="password"></form>'
    input('#new').focus()
    field()
    // The page moved the focus to another password field before the fill.
    input('#current').focus()
    expect(fill()).toBe('none')
    expect([input('#current').value, input('#new').value]).toEqual(['', ''])

    // A fill without a field kept first, or a second one after it, fills nothing.
    input('#new').focus()
    expect(fill()).toBe('none')
    field()
    expect(fill()).toBe('filled')
    input('#new').value = ''
    expect(fill()).toBe('none')
    expect(input('#new').value).toBe('')
  })

  it('confirms in a change-password form, but never fills the current password', () => {
    document.body.innerHTML = '<form><input id="current" type="password" autocomplete="current-password"><input id="new" type="password" autocomplete="new-password"><input id="confirm" type="password" autocomplete="new-password"></form>'
    expect(suggestIn('#new')).toBe('filled')
    expect([input('#current').value, input('#new').value, input('#confirm').value]).toEqual(['', PASSWORD, PASSWORD])

    // The current password follows the new one here, so it is not a confirmation.
    document.body.innerHTML = '<form><input id="new" type="password"><input id="current" type="password" autocomplete="current-password"></form>'
    expect(suggestIn('#new')).toBe('filled')
    expect(input('#current').value).toBe('')
  })

  it('confirms only with the next field of the same form, or of the fields outside any form', () => {
    document.body.innerHTML = '<form><input id="login" type="password"></form><form><input id="other" type="password"></form>'
    expect(suggestIn('#login')).toBe('filled')
    expect(input('#other').value).toBe('')

    document.body.innerHTML = '<input id="sign-in" type="password"><input id="email" type="email"><input id="sign-up" type="password">'
    expect(suggestIn('#sign-in')).toBe('filled')
    expect(input('#sign-up').value).toBe('')

    // A field that does not show between them, or a checkbox that shows the password, is no field the person fills.
    document.body.innerHTML = '<input id="new" type="password"><input type="checkbox"><input type="text" hidden><div style="display:none"><input type="text"></div><input id="confirm" type="password">'
    expect(suggestIn('#new')).toBe('filled')
    expect(input('#confirm').value).toBe(PASSWORD)
  })

  it('leaves a password field that does not show empty, as a saved password’s fill does', () => {
    for (const hidden of ['hidden', 'aria-hidden="true"', 'style="display:none"', 'inert']) {
      document.body.innerHTML = `<form><input id="new" type="password"><input id="decoy" type="password" ${hidden}></form>`
      expect(suggestIn('#new')).toBe('filled')
      expect(input('#decoy').value).toBe('')
    }
  })

  it('fills nothing in a field that cannot take the whole password, or on another page', () => {
    document.body.innerHTML = '<form><input id="short" type="password" maxlength="8"><input id="confirm" type="password"></form>'
    expect(suggestIn('#short')).toBe('none')
    expect([input('#short').value, input('#confirm').value]).toEqual(['', ''])

    document.body.innerHTML = '<form><input id="new" type="password"></form>'
    input('#new').focus()
    field()
    expect(fill(PASSWORD, 'https://elsewhere.example/')).toBe('none')
    expect(input('#new').value).toBe('')
  })

  it('sets the value with the browser’s own setter, as a framework watching the field expects', () => {
    document.body.innerHTML = '<form><input id="new" type="password"></form>'
    const target = input('#new')
    let pageSetter = 0
    Object.defineProperty(target, 'value', {
      configurable: true,
      get: () => Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.get!.call(target),
      set: () => { pageSetter++ }
    })
    expect(suggestIn('#new')).toBe('filled')
    expect(pageSetter).toBe(0)
    expect(target.value).toBe(PASSWORD)
  })
})
