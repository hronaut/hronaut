import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { frameObservationScript } from '../src/main/browser/frame-observation-script.js'

/** The link sanitizer of the frame observation script, as its source carries it. */
function frameLinkSanitizer(): (href: string) => string {
  const source = frameObservationScript('iframe', 1_000, 'expectedFrame')
  const sanitizer = /const safeUrl=(node=>\{[\s\S]*?\n {6}\});\n {6}const append=/u.exec(source)?.[1]
  if (!sanitizer) throw new Error('The frame observation script has no link sanitizer')
  return href => runInNewContext(`(${sanitizer})(node)`, {
    node: { getAttribute: () => href }, child: { baseURI: 'https://frame.example/page' }, omissions: new Set(), URL
  }) as string
}

it('redacts keys, session ids and signatures in the links of a same-origin frame', () => {
  const safeUrl = frameLinkSanitizer()
  // A map's API key and a shop's session stayed in the links an agent was given.
  expect(safeUrl('https://maps.example/embed?key=AIzaSECRET&q=Paris')).toBe('https://maps.example/embed?key=%5BREDACTED%5D&q=Paris')
  expect(safeUrl('/cart;JSESSIONID=SECRET?PHPSESSID=SECRET&step=2#top')).toBe('https://frame.example/cart;JSESSIONID=[REDACTED]?PHPSESSID=%5BREDACTED%5D&step=2')
  expect(safeUrl('https://store.example/invoice.pdf?sig=SECRET&subscription-key=SECRET&access-key=SECRET')).not.toContain('SECRET')
  expect(safeUrl('https://contoso.sharepoint.com/_layouts/15/download.aspx?UniqueId=1d2c&tempauth=SECRET&hm=SECRET&hmac=SECRET&md5=SECRET'))
    .toBe('https://contoso.sharepoint.com/_layouts/15/download.aspx?UniqueId=1d2c&tempauth=%5BREDACTED%5D&hm=%5BREDACTED%5D&hmac=%5BREDACTED%5D&md5=%5BREDACTED%5D')
  expect(safeUrl('https://cdn.fbsbx.com/v/report.pdf?oh=SECRET&oe=6720F3A1&authkey=SECRET&rlkey=SECRET&resourcekey=SECRET'))
    .toBe('https://cdn.fbsbx.com/v/report.pdf?oh=%5BREDACTED%5D&oe=6720F3A1&authkey=%5BREDACTED%5D&rlkey=%5BREDACTED%5D&resourcekey=%5BREDACTED%5D')
  expect(safeUrl('https://forum.example/login.php?id=ada&pw=SECRET&pass=SECRET')).toBe('https://forum.example/login.php?id=ada&pw=%5BREDACTED%5D&pass=%5BREDACTED%5D')
  expect(safeUrl('https://cms.example/user?user%5Bpass%5D=SECRET&pass1=SECRET&current_pass=SECRET&passwrd=SECRET&pass_rate=high'))
    .toBe('https://cms.example/user?user%5Bpass%5D=%5BREDACTED%5D&pass1=%5BREDACTED%5D&current_pass=%5BREDACTED%5D&passwrd=%5BREDACTED%5D&pass_rate=high')
  expect(safeUrl('https://example.test/?keyword=shoes&author=me&side=left')).toBe('https://example.test/?keyword=shoes&author=me&side=left')
})
