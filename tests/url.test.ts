import { describe, expect, it } from 'vitest'
import { isAgentWorkspaceNavigationUrl, isHronautHomeUrl, normalizeAddress } from '../src/main/browser/url.js'

describe('isHronautHomeUrl', () => {
  it('recognizes the Home origin without accepting lookalike hosts or userinfo', () => {
    expect(isHronautHomeUrl('hronaut://home/')).toBe(true)
    expect(isHronautHomeUrl('hronaut://home/api/status')).toBe(true)
    expect(isHronautHomeUrl('hronaut://home.example/')).toBe(false)
    expect(isHronautHomeUrl('hronaut://home@other.example/')).toBe(false)
    expect(isHronautHomeUrl('hronaut://homepage/')).toBe(false)
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

  it('turns plain text into a search', () => {
    expect(normalizeAddress('persistent electron browser')).toBe(
      'https://www.google.com/search?q=persistent%20electron%20browser'
    )
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
