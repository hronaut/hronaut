import { describe, expect, it } from 'vitest'
import { isAgentWorkspaceNavigationUrl, isHronautHomeUrl, normalizeAddress, webAddress } from '../src/main/browser/url.js'

describe('isHronautHomeUrl', () => {
  it('recognizes the Home origin without accepting lookalike hosts or userinfo', () => {
    expect(isHronautHomeUrl('hronaut://home/')).toBe(true)
    expect(isHronautHomeUrl('hronaut://home/api/status')).toBe(true)
    expect(isHronautHomeUrl('hronaut://home.example/')).toBe(false)
    expect(isHronautHomeUrl('hronaut://home@other.example/')).toBe(false)
    expect(isHronautHomeUrl('hronaut://homepage/')).toBe(false)
  })

  it('parses an address once while it is asked about again, and keeps answering right after many others', () => {
    const Parser = globalThis.URL
    let parses = 0
    globalThis.URL = class extends Parser { constructor(...input: ConstructorParameters<typeof URL>) { super(...input); parses += 1 } }
    try {
      for (let round = 0; round < 3; round++) {
        expect(isHronautHomeUrl('hronaut://home/?repeat')).toBe(true)
        expect(isHronautHomeUrl('https://example.test/repeat')).toBe(false)
      }
      expect(parses).toBe(2)
      for (let index = 0; index < 600; index++) isHronautHomeUrl(`https://example.test/${index}`)
      expect(isHronautHomeUrl('hronaut://home/?repeat')).toBe(true)
      expect(isHronautHomeUrl('hronaut://home@other.example/?repeat')).toBe(false)
      // A long address, such as a data: page, is parsed each time instead of being kept.
      const long = `data:text/html,${'x'.repeat(4096)}`
      parses = 0
      expect(isHronautHomeUrl(long)).toBe(false)
      expect(isHronautHomeUrl(long)).toBe(false)
      expect(parses).toBe(2)
    } finally {
      globalThis.URL = Parser
    }
  })
})

describe('normalizeAddress', () => {
  it('keeps explicit schemes', () => {
    expect(normalizeAddress('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeAddress('about:blank')).toBe('about:blank')
    expect(normalizeAddress('web+demo:docs.example')).toBe('web+demo:docs.example')
    expect(normalizeAddress('web+demo:docs.example/path?mode=read')).toBe('web+demo:docs.example/path?mode=read')
  })

  it('turns host-like input into an HTTPS URL', () => {
    expect(normalizeAddress('example.com/docs')).toBe('https://example.com/docs')
    expect(normalizeAddress('example.com:8443/docs')).toBe('https://example.com:8443/docs')
    expect(normalizeAddress('example.com/@person')).toBe('https://example.com/@person')
  })

  it.each([
    ['localhost:5173', 'http://localhost:5173'],
    ['LOCALHOST', 'http://LOCALHOST'],
    ['LOCALHOST:5173', 'http://LOCALHOST:5173'],
    ['Localhost:5173/app', 'http://Localhost:5173/app'],
    ['localhost:5173?mode=qa', 'http://localhost:5173?mode=qa'],
    ['localhost#readiness', 'http://localhost#readiness'],
    ['localhost.', 'http://localhost.'],
    ['app.localhost:4173/dashboard', 'http://app.localhost:4173/dashboard'],
    ['127.0.0.1:8081/ui-kit', 'http://127.0.0.1:8081/ui-kit'],
    ['127.0.0.1:8081?panel=network', 'http://127.0.0.1:8081?panel=network'],
    ['127.42.0.9:3000', 'http://127.42.0.9:3000'],
    ['[::1]:6006', 'http://[::1]:6006'],
    ['[::1]:6006#storybook', 'http://[::1]:6006#storybook']
  ])('uses HTTP for a scheme-less loopback development address %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each([
    ['192.168.1.20:5173', 'http://192.168.1.20:5173'],
    ['10.0.0.8:3000/app', 'http://10.0.0.8:3000/app'],
    ['172.16.4.2:8080', 'http://172.16.4.2:8080'],
    ['172.31.255.1', 'http://172.31.255.1'],
    ['169.254.10.1', 'http://169.254.10.1'],
    ['100.101.102.103:4173', 'http://100.101.102.103:4173'],
    ['0.0.0.0:3000', 'http://0.0.0.0:3000'],
    ['[fe80::1]:3000', 'http://[fe80::1]:3000'],
    ['[FD12:3456::1]:8080', 'http://[FD12:3456::1]:8080'],
    ['[::]:8080', 'http://[::]:8080'],
    ['nas.local:5000', 'http://nas.local:5000'],
    ['Printer.LOCAL.', 'http://Printer.LOCAL.'],
    ['host.docker.internal:3000/health', 'http://host.docker.internal:3000/health'],
    ['router.home.arpa', 'http://router.home.arpa'],
    ['shop.test', 'http://shop.test'],
    ['10.0.0.1.', 'http://10.0.0.1.'],
    ['10.5:3000', 'http://10.5:3000'],
    ['0x0a.0.0.1', 'http://0x0a.0.0.1']
  ])('uses HTTP for a scheme-less local network address %s', (input, expected) => {
    // It opened over HTTPS, which a development server on the local network does not serve, so the page failed to load.
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each([
    ['172.32.0.1', 'https://172.32.0.1'],
    ['172.15.0.1', 'https://172.15.0.1'],
    ['100.128.0.1', 'https://100.128.0.1'],
    ['192.169.1.1', 'https://192.169.1.1'],
    ['8.8.8.8', 'https://8.8.8.8'],
    ['[2001:db8::1]', 'https://[2001:db8::1]'],
    ['local.example.com', 'https://local.example.com'],
    ['internal.example.com/docs', 'https://internal.example.com/docs'],
    ['example.localdomain.com', 'https://example.localdomain.com'],
    ['foo.local.example.com', 'https://foo.local.example.com'],
    ['11.0.0.1', 'https://11.0.0.1'],
    ['9.255.255.255', 'https://9.255.255.255'],
    ['100.63.255.255', 'https://100.63.255.255'],
    ['169.253.0.1', 'https://169.253.0.1'],
    ['192.167.255.255', 'https://192.167.255.255'],
    ['[fbff::1]', 'https://[fbff::1]'],
    ['[fec0::1]', 'https://[fec0::1]']
  ])('keeps HTTPS for the public address %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each([
    ['devbox:3000', 'http://devbox:3000'],
    ['nas:5000/webman/index.cgi', 'http://nas:5000/webman/index.cgi'],
    ['My-PC:8080?tab=logs', 'http://My-PC:8080?tab=logs'],
    ['web_1:3000#health', 'http://web_1:3000#health'],
    ['deadbeef:8080', 'http://deadbeef:8080'],
    ['router:443/admin', 'https://router:443/admin']
  ])('opens a one-word host name with a port as a website: %s', (input, expected) => {
    // It came back as a `devbox:` URL, which a workspace tab refuses, so the development server on that machine never
    // opened.
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each(['tel:911', 'SMS:12345', 'sip:1001', 'facetime-audio:5551', 'web+demo:12', 'http:3000', 'HTTPS:443'])(
    'keeps %s as typed', (input) => {
      expect(normalizeAddress(input)).toBe(input)
    }
  )

  it.each([
    ['192.168.1.1:443', 'https://192.168.1.1:443'],
    ['nas.local:443/admin', 'https://nas.local:443/admin'],
    ['localhost:443', 'https://localhost:443']
  ])('keeps HTTPS for a local address that names port 443: %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each([
    'site:github.com electron', 'TypeError: Cannot read properties of undefined', 'error: failed to push some refs',
    're: meeting notes', 'localhost:3000 not loading', 'note:\tbuy milk'
  ])('searches text with spaces after a word and a colon: %s', (input) => {
    // A workspace tab refused it as an address of an unknown scheme, such as `site:`, instead of searching.
    expect(normalizeAddress(input)).toBe(`https://www.google.com/search?q=${encodeURIComponent(input)}`)
    expect(webAddress(input)).toBeUndefined()
  })

  it.each([
    'mailto:team@example.com?subject=Release notes', 'tel:+1 555 0100', 'SMS:+1 555 0100', 'web+demo:open the docs',
    'javascript:void 0', 'http:3000 /docs', 'site:github.com', 'magnet:?xt=urn:btih:abc', 'spotify:track:4uLU6hMCjMI75M1A2tKUQC'
  ])('keeps a link of a scheme as typed: %s', (input) => {
    expect(normalizeAddress(input)).toBe(input)
  })

  it('keeps a Windows path with spaces from the search engine', () => {
    expect(normalizeAddress('C:\\Program Files\\app\\readme.html')).toBe('C:\\Program Files\\app\\readme.html')
  })

  it.each(['admin:pass word@router.local', 'user:secret@host.test/my page'])('keeps a sign-in typed with spaces from the search engine: %s', (input) => {
    // Its password would have gone to the search engine in the search's address.
    expect(normalizeAddress(input)).toBe(input)
  })

  it('turns plain text into a search', () => {
    expect(normalizeAddress('persistent electron browser')).toBe(
      'https://www.google.com/search?q=persistent%20electron%20browser'
    )
  })

  it.each([
    '999.999.999.999', 'localhost:65536', 'example.com:65536', 'devbox:65536',
    '10:30', '16:9', '0:3000', '0x7f000001:8080', '010:80', '1080p:60', 'admin@router:8080'
  ])(
    'searches an invalid scheme-less host instead of navigating to %s', (input) => {
      expect(normalizeAddress(input)).toBe(`https://www.google.com/search?q=${encodeURIComponent(input)}`)
    }
  )

  it.each([
    '3.14', '1.5', '2.0', '0.5', '10.5', '127.1', '1.2.3', '10.0.0', '3.14.',
    '22.5/7', '3.14/2', '2.5?', '3.14#x', '1.2:45', '\uff13.\uff11\uff14', '\uff11.\uff12.\uff13'
  ])(
    'searches the number %s instead of opening it as a short IPv4 address', (input) => {
      // 3.14 opened https://3.0.0.14 and 22.5/7 opened https://22.0.0.5/7, servers on the internet, as Chrome does not.
      expect(normalizeAddress(input)).toBe(`https://www.google.com/search?q=${encodeURIComponent(input)}`)
    }
  )

  it.each([
    ['1.2/', 'https://1.2/'],
    ['10.5/admin', 'http://10.5/admin'],
    ['127.1:8080', 'http://127.1:8080'],
    ['192.168.1/router', 'http://192.168.1/router'],
    ['8.8.8.8', 'https://8.8.8.8'],
    ['1.2.3.4', 'https://1.2.3.4']
  ])('still opens %s: a full address, a trailing slash, or a local address with a port or path', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it('searches email-shaped input instead of treating it as URL credentials', () => {
    expect(normalizeAddress('person@example.com')).toBe(
      'https://www.google.com/search?q=person%40example.com'
    )
  })

  it.each([
    ['duckduckgo', 'https://duckduckgo.com/?q=persistent%20electron%20browser'],
    ['bing', 'https://www.bing.com/search?q=persistent%20electron%20browser'],
    ['brave', 'https://search.brave.com/search?q=persistent%20electron%20browser'],
    ['startpage', 'https://www.startpage.com/sp/search?query=persistent%20electron%20browser']
  ] as const)('uses the selected %s search engine', (engine, expected) => {
    expect(normalizeAddress('persistent electron browser', engine)).toBe(expected)
  })

  it('uses a blank page for empty input', () => {
    expect(normalizeAddress('   ')).toBe('about:blank')
  })
})

describe('isAgentWorkspaceNavigationUrl', () => {
  it.each([
    'about:blank',
    'ABOUT:blank',
    'https://example.com/page',
    'http://localhost:4173/',
    'data:text/html,<h1>QA fixture</h1>',
    'view-source:https://example.com/',
    'View-Source:https://example.com/',
    'blob:https://example.com/01912345-6789-7abc-8def-0123456789ab',
    'BLOB:https://example.com/01912345-6789-7abc-8def-0123456789ab'
  ])('keeps non-privileged agent documents available: %s', (url) => {
    expect(isAgentWorkspaceNavigationUrl(url)).toBe(true)
  })

  it.each([
    'file:///tmp/private.txt',
    'https://agent:embedded-secret@example.com/private?token=query-secret',
    'view-source:https://agent:embedded-secret@example.com/private',
    'View-Source:https://agent:embedded-secret@example.com/private',
    'blob:https://agent:embedded-secret@example.com/01912345-6789-7abc-8def-0123456789ab',
    'BLOB:https://agent:embedded-secret@example.com/01912345-6789-7abc-8def-0123456789ab',
    'hronaut://home/',
    'chrome://version',
    'devtools://devtools/bundled/inspector.html',
    'javascript:document.body.textContent',
    'view-source:file:///tmp/private.txt',
    'blob:null/01912345-6789-7abc-8def-0123456789ab',
    'blob:file:///tmp/private.txt'
  ])('rejects local or privileged agent documents: %s', (url) => {
    expect(isAgentWorkspaceNavigationUrl(url)).toBe(false)
  })
})

describe('webAddress', () => {
  it('gives the address a typed input names, and nothing for search terms', () => {
    expect(webAddress(' https://example.com/path ')).toBe('https://example.com/path')
    expect(webAddress('localhost:5173/checkout')).toBe('http://localhost:5173/checkout')
    expect(webAddress('example.com')).toBe('https://example.com')
    expect(webAddress('about:blank')).toBe('about:blank')
    expect(webAddress('cheap flights')).toBeUndefined()
    expect(webAddress('user@example.com')).toBeUndefined()
    // normalizeAddress still searches for them with the chosen engine.
    expect(normalizeAddress('cheap flights', 'duckduckgo')).toBe('https://duckduckgo.com/?q=cheap%20flights')
  })
})
