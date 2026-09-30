import { describe, expect, it } from 'vitest'
import { Address6 } from 'ip-address'
import { ipKeyGenerator } from 'express-rate-limit'

// Regression coverage for GHSA-rpw4-54j3-4h4q and GHSA-2vr4-cq9g-pvrc
// in the rate limiter's transitive dependency. These classifiers are not
// themselves Hronaut's network access policy.
describe('IP address dependency', () => {
  it.each(['fe80::1', 'fe81::1', 'febf::1', 'fe80:0:0:1::1'])(
    'recognizes link-local address %s throughout fe80::/10', address => {
      expect(new Address6(address).isLinkLocal()).toBe(true)
    }
  )

  it.each(['64:ff9b:1:7f00:0:100::', '64:ff9b:1::7f00:1'])(
    'recognizes local-use NAT64 address %s as private', address => {
      expect(new Address6(address).isPrivate()).toBe(true)
    }
  )

  it('keeps public IPv6 addresses outside the private and link-local ranges', () => {
    const address = new Address6('2606:4700:4700::1111')
    expect(address.isPrivate()).toBe(false)
    expect(address.isLinkLocal()).toBe(false)
  })

  it('preserves mapped IPv4 and IPv6 subnet keys used by the rate limiter', () => {
    expect(ipKeyGenerator('::ffff:192.0.2.1')).toBe('192.0.2.1')
    expect(ipKeyGenerator('2001:db8:abcd:1200::1'))
      .toBe(ipKeyGenerator('2001:db8:abcd:12ff::2'))
    expect(ipKeyGenerator('2001:db8:abcd:1200::1'))
      .not.toBe(ipKeyGenerator('2001:db8:abcd:1300::1'))
  })
})
