// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { credentialCapturePageScript } from '../src/main/browser/credential-capture-page.js'

const realClientRects = Element.prototype.getClientRects

beforeEach(() => {
  // jsdom lays nothing out: a field shows unless it, or a box around it, is not displayed.
  Element.prototype.getClientRects = function (this: Element) {
    return (this.closest('[style*="display:none"]') ? [] : [{ width: 120, height: 24 }]) as unknown as DOMRectList
  }
})

afterEach(() => {
  Element.prototype.getClientRects = realClientRects
  vi.useRealTimers()
  window.dispatchEvent(new Event('pagehide'))
  document.body.innerHTML = ''
})

it('keeps the username from an earlier step in the same login document', async () => {
  document.body.innerHTML = '<form><input autocomplete="username" value="alice"><button>Next</button></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  document.body.innerHTML = '<form><input type="password" autocomplete="current-password" value="alice-secret"></form>'
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await expect(candidate).resolves.toMatchObject({ username: 'alice', password: 'alice-secret' })
})

it.each(['alice', 'bob'])('captures a form-less two-step login for %s', async username => {
  document.body.innerHTML = '<input autocomplete="section-login username"><button>Next</button>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('input')!.value = username
  document.querySelector('input')!.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('button')!.click()
  document.body.innerHTML = '<input type="password" value="secret"><button>Log in</button>'
  document.querySelector('button')!.click()
  await expect(candidate).resolves.toMatchObject({ username, password: 'secret' })
})

it('uses the current read-only account instead of the remembered account', async () => {
  document.body.innerHTML = '<form><input autocomplete="username" value="alice"></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  document.body.innerHTML = '<form><input autocomplete="section-login username" readonly value="bob"><input type="password" value="secret"></form>'
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  await expect(candidate).resolves.toMatchObject({ username: 'bob' })
})

it('does not borrow an account from a separate form still on the page', async () => {
  document.body.innerHTML = '<form id="other"><input autocomplete="username" value="alice"></form><form id="login"><input type="password" value="secret"></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('#other input')!.dispatchEvent(new Event('input', { bubbles: true }))
  document.querySelector('#login')!.dispatchEvent(new Event('submit', { bubbles: true }))
  await expect(candidate).resolves.toMatchObject({ username: '' })
})

it('expires an earlier account and clears it when the document is left', async () => {
  vi.useFakeTimers()
  document.body.innerHTML = '<form><input autocomplete="username" value="alice"></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  vi.advanceTimersByTime(300_001)
  document.body.innerHTML = '<form><input type="password" value="secret"></form>'
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  await expect(candidate).resolves.toMatchObject({ username: '' })
  const next = window.eval(credentialCapturePageScript()) as Promise<unknown>
  window.dispatchEvent(new Event('pagehide'))
  await expect(next).resolves.toBeNull()
})

it('can observe another account after completing a capture in the same document', async () => {
  for (const username of ['alice', 'bob', 'alice']) {
    document.body.innerHTML = '<form><input name="username"><input type="password" value="secret"></form>'
    document.querySelector<HTMLInputElement>('[name="username"]')!.value = username
    const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    await expect(candidate).resolves.toMatchObject({ username })
  }
})

it('captures a JavaScript-driven login button inside a form', async () => {
  document.body.innerHTML =
    '<form>' +
      '<input autocomplete="username" value="alex">' +
      '<input type="password" autocomplete="current-password" value="spassword">' +
      '<button type="button" id="login">Log in</button>' +
    '</form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.getElementById('login')!.click()
  await expect(candidate).resolves.toMatchObject({ username: 'alex', password: 'spassword' })
})

it('captures a custom button inside a form', async () => {
  document.body.innerHTML =
    '<form><input autocomplete="username" value="alex"><input type="password" value="secret">' +
    '<div role="button" tabindex="0">Sign in</div></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector<HTMLElement>('[role="button"]')!.click()
  await expect(candidate).resolves.toMatchObject({ username: 'alex', password: 'secret' })
})

it('waits for validation before capturing a native form submit button', async () => {
  document.body.innerHTML =
    '<form><input type="email" required value="invalid"><input type="password" value="secret">' +
    '<button>Log in</button></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('button')!.click()
  window.dispatchEvent(new Event('pagehide'))
  await expect(candidate).resolves.toBeNull()
})

it.each(['Sign up', 'Create account', 'Create an account', 'Register', 'Change password', 'Update password'])(
  'captures a JavaScript-driven %s button, as a sign-up or password change uses',
  async (label) => {
    document.body.innerHTML =
      '<form><input type="email" name="email" value="ada@example.com"><input type="password" value="k7Gm2xPqR9sTv4w">' +
      `<input type="password" value="k7Gm2xPqR9sTv4w"><button type="button">${label}</button></form>`
    const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
    document.querySelector('button')!.click()
    await expect(candidate).resolves.toMatchObject({ username: 'ada@example.com', password: 'k7Gm2xPqR9sTv4w' })
  }
)

it('captures the new password from a form that changes one, as Chrome saves it', async () => {
  document.body.innerHTML =
    '<form><input autocomplete="username" value="ada"><input type="password" autocomplete="current-password" value="old-secret">' +
    '<input type="password" autocomplete="new-password" value="k7Gm2xPqR9sTv4w"><input type="password" autocomplete="new-password" value="k7Gm2xPqR9sTv4w"></form>'
  const marked = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  await expect(marked).resolves.toMatchObject({ username: 'ada', password: 'k7Gm2xPqR9sTv4w' })

  // Without autocomplete, the current password comes first and the new one twice after it.
  document.body.innerHTML =
    '<form><input type="password" value="old-secret"><input type="password" value="k7Gm2xPqR9sTv4w"><input type="password" value="k7Gm2xPqR9sTv4w"></form>'
  const unmarked = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  await expect(unmarked).resolves.toMatchObject({ password: 'k7Gm2xPqR9sTv4w' })
})

it('offers nothing for a secret a settings page saves with a scripted Save or Submit button', async () => {
  for (const label of ['Save', 'Submit']) {
    document.body.innerHTML =
      '<form><input type="email" name="email" value="ada@example.com"><input type="password" name="api-key" value="sk-live-123">' +
      `<button type="button">${label}</button></form>`
    const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
    document.querySelector('button')!.click()
    window.dispatchEvent(new Event('pagehide'))
    await expect(candidate).resolves.toBeNull()
  }
})

it('offers no new password from fields that do not show, such as a combined sign-in and sign-up form', async () => {
  document.body.innerHTML =
    '<form><input autocomplete="username" value="ada"><input type="password" autocomplete="current-password" value="secret">' +
    '<div style="display:none"><input type="password" autocomplete="new-password" value="old-draft"><input type="password" autocomplete="new-password" value="old-draft"></div></form>'
  const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
  document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
  window.dispatchEvent(new Event('pagehide'))
  await expect(candidate).resolves.toBeNull()
})

it('offers nothing for passwords that do not match', async () => {
  for (const fields of [
    '<input type="password" autocomplete="new-password" value="one"><input type="password" autocomplete="new-password" value="two">',
    '<input type="password" value="one"><input type="password" value="two">',
    '<input type="password" value="old"><input type="password" value="one"><input type="password" value="two">',
    '<input type="password" autocomplete="current-password" value="old"><input type="password" autocomplete="new-password" value="one"><input type="password" value="two">'
  ]) {
    document.body.innerHTML = `<form>${fields}</form>`
    const candidate = window.eval(credentialCapturePageScript()) as Promise<unknown>
    document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true }))
    window.dispatchEvent(new Event('pagehide'))
    await expect(candidate).resolves.toBeNull()
  }
})
