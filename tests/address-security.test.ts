import { describe, expect, it } from 'vitest'
import { addressSecurity } from '../src/shared/address-security.js'

describe('the connection the address bar shows', () => {
  it('calls an HTTPS page secure, wherever it is', () => {
    expect(addressSecurity('https://example.com/login')).toBe('secure')
    expect(addressSecurity('https://localhost:3000/')).toBe('secure')
  })

  it.each([
    'http://localhost:5173/',
    'http://LOCALHOST./',
    'http://app.localhost/',
    'http://127.0.0.1:8080/',
    'http://127.1/',
    'http://127.255.0.9/',
    'http://[::1]:3000/',
    'http://[0:0:0:0:0:0:0:1]/'
  ])('calls an HTTP page on this computer local: %s', (address) => {
    expect(addressSecurity(address)).toBe('local')
  })

  it.each([
    'http://example.com/',
    'http://192.168.1.20:3000/',
    'http://10.0.0.5/',
    'http://0.0.0.0:8080/',
    'http://[::ffff:127.0.0.1]/',
    'http://localhost.example.com/',
    'http://127.0.0.1.nip.io/',
    'http://devbox:3000/'
  ])('calls any other HTTP page not secure, as Chrome does: %s', (address) => {
    expect(addressSecurity(address)).toBe('not-secure')
  })

  it.each([undefined, null, '', 'hronaut://home', 'file:///tmp/page.html', 'data:text/html,hi', 'about:blank', 'not a url'])(
    'describes no connection for %s',
    (address) => {
      expect(addressSecurity(address)).toBeNull()
    }
  )
})
