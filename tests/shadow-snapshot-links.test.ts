// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { shadowSnapshotScript } from '../src/main/browser/shadow-snapshot/shadow-snapshot-script.js'

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

it('redacts keys, session ids and signatures in the links of a shadow root', () => {
  document.body.innerHTML = '<x-card></x-card>'
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({ width: 10, height: 10 } as DOMRect)
  Object.defineProperty(HTMLElement.prototype, 'innerText', { configurable: true, get() { return this.textContent } })
  Object.defineProperty(Element.prototype, 'checkVisibility', { configurable: true, value: () => true })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ width: 10, height: 10 }] })
  document.querySelector('x-card')!.attachShadow({ mode: 'open' }).innerHTML = `
    <a href="https://maps.example/embed?key=AIzaSECRET&q=Paris">Map</a>
    <a href="https://shop.example/cart;jsessionid=SECRET?PHPSESSID=SECRET&step=2">Cart</a>
    <a href="https://store.blob.core.windows.net/invoice.pdf?sv=1&sig=SECRET">Invoice</a>
    <a href="https://cdn.discordapp.com/attachments/1/2/a.pdf?ex=6720f3a1&hm=SECRET&tempauth=SECRET">Attachment</a>
    <a href="https://forum.example/login.php?id=ada&pw=SECRET&pass=SECRET">Forum</a>
    <a href="https://cms.example/user?id=ada&user%5Bpass%5D=SECRET&pass1=SECRET&current_pass=SECRET&passwrd=SECRET&pass_rate=high">Account</a>
  `
  const page = window.eval(shadowSnapshotScript('x-card', 5_000)) as { text?: string }
  // A map's API key and a shop's session stayed in the links an agent was given.
  expect(page.text).toContain('Map')
  expect(page.text).not.toContain('SECRET')
  expect(page.text).toContain('q=Paris')
  expect(page.text).toContain('step=2')
  expect(page.text).toContain('id=ada')
  expect(page.text).toContain('pass_rate=high')
})
