// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { credentialCapturePageScript } from '../src/main/browser/credential-capture-page.js'

afterEach(() => {
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
