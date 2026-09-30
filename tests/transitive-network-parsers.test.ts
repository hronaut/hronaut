import { Address4, Address6 } from 'ip-address'
import { equal, parse } from 'fast-uri'
import { expect, it } from 'vitest'

it('normalizes percent-encoded host case consistently in scheme-relative URIs', () => {
  expect(parse('//%41.com').host).toBe('a.com')
  expect(equal('//%41.com', '//a.com')).toBe(true)
  expect(equal('//A.com', '//a.com')).toBe(true)
})

it('rejects cross-family subnet membership while preserving same-family checks', () => {
  expect(new Address6('a00::1').isInSubnet(new Address4('10.0.0.0/8'))).toBe(false)
  expect(new Address4('32.0.0.1').isInSubnet(new Address6('2000::/3'))).toBe(false)
  expect(new Address4('10.0.0.1').isInSubnet(new Address4('10.0.0.0/8'))).toBe(true)
  expect(new Address6('2001:db8::1').isInSubnet(new Address6('2001:db8::/32'))).toBe(true)
})

it('rejects oversized invalid IPv6 input without constructing an input-sized diagnostic', () => {
  let failure: unknown
  try { new Address6('!'.repeat(4096)) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect((failure as Error).message.length).toBeLessThan(1024)
  expect((failure as { parseMessage?: string }).parseMessage?.length ?? 0).toBeLessThan(1024)
})
