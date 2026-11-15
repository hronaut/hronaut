import { describe, expect, it } from 'vitest'
import { buildBrowsingDataWebsiteInventory, cookieAvailableToOrigin } from '../../src/main/site-data/browsing-data-websites.js'

describe('buildBrowsingDataWebsiteInventory', () => {
  it('merges global profile sources into independently sorted website rows', () => {
    const websites = buildBrowsingDataWebsiteInventory({
      history: [
        { id: 'one', url: 'https://docs.example.test/guide', title: 'Guide', visitedAt: '2026-08-12T12:00:00.000Z', visitCount: 3 },
        { id: 'two', url: 'https://example.test/', title: 'Example', visitedAt: '2026-08-13T12:00:00.000Z', visitCount: 1 }
      ],
      cookies: [
        { domain: '.example.test', hostOnly: false, secure: true },
        { domain: 'cookie-only.test', hostOnly: true, secure: false }
      ],
      bookmarks: [{ id: 'bookmark', url: 'https://docs.example.test/reference', title: 'Reference', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }],
      credentials: [{ id: 'credential', origin: 'https://example.test', username: 'owner', createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' }],
      permissions: [{ origin: 'https://camera.test', permission: 'geolocation', decision: 'deny', workspaceId: '01912345-6789-7abc-8def-0123456789ab' }],
      tabs: [{ id: 'tab', title: 'Open tab', url: 'https://open.test/path', loading: false, navigationGeneration: 0, canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false }]
    })

    expect(websites.map((site) => site.origin)).toEqual([
      'https://example.test',
      'https://docs.example.test',
      'https://camera.test',
      'http://cookie-only.test',
      'https://open.test'
    ])
    expect(websites[0]).toMatchObject({ title: 'Example', cookieCount: 1, historyEntries: 1, historyVisits: 1, savedPasswordCount: 1 })
    expect(websites[1]).toMatchObject({ title: 'Guide', cookieCount: 1, historyEntries: 1, historyVisits: 3, bookmarkCount: 1 })
    expect(websites[2]).toMatchObject({ permissionDecisionCount: 1 })
    expect(websites[3]).toMatchObject({ cookieCount: 1 })
    expect(websites[4]).toMatchObject({ openTabCount: 1 })
  })

  it('keeps secure cookies away from HTTP origins and ignores non-web sources', () => {
    const websites = buildBrowsingDataWebsiteInventory({
      history: [],
      cookies: [{ domain: 'secure.test', hostOnly: true, secure: true }],
      bookmarks: [],
      credentials: [],
      permissions: [],
      tabs: [
        { id: 'http', title: 'HTTP', url: 'http://secure.test/', loading: false, navigationGeneration: 0, canGoBack: false, canGoForward: false, active: false, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false },
        { id: 'file', title: 'File', url: 'file:///tmp/test', loading: false, navigationGeneration: 0, canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false }
      ]
    })

    expect(websites).toHaveLength(2)
    expect(websites.find((site) => site.origin === 'http://secure.test')?.cookieCount).toBe(0)
    expect(websites.find((site) => site.origin === 'https://secure.test')?.cookieCount).toBe(1)
  })

  it('includes cookie-only IPv6 websites without double-bracketing their origin', () => {
    const websites = buildBrowsingDataWebsiteInventory({
      history: [],
      cookies: [{ domain: '[::1]', hostOnly: true, secure: false }],
      bookmarks: [],
      credentials: [],
      permissions: [],
      tabs: []
    })

    expect(websites).toEqual([
      expect.objectContaining({
        origin: 'http://[::1]',
        hostname: '[::1]',
        cookieCount: 1
      })
    ])
  })
})

describe('cookieAvailableToOrigin', () => {
  it.each(['http://localhost:3000', 'http://app.localhost', 'http://localhost.:3000', 'http://127.0.0.1:5173', 'http://127.10.0.1', 'http://[::1]:8080'])('counts a Secure cookie for the local address %s, which Chromium sends it to', (origin) => {
    const domain = new URL(origin).hostname
    expect(cookieAvailableToOrigin({ domain, hostOnly: true, secure: true, path: '/' }, origin)).toBe(true)
  })

  it.each(['http://example.test', 'http://localhost.example.test', 'http://128.0.0.1'])('keeps a Secure cookie away from the plain HTTP address %s', (origin) => {
    expect(cookieAvailableToOrigin({ domain: new URL(origin).hostname, hostOnly: true, secure: true, path: '/' }, origin)).toBe(false)
  })

  it.each([
    ['/', true], ['/app', true], ['/100%', true], ['/a%2fb', true], ['//', true], ['//[', true], ['//x', true],
    ['/a b', false], ['/x?y', false], ['/a/../b', false], ['/a|b', false]
  ] as const)(
    'counts a cookie on the path %s only when a request can match it: %s', (path, received) => {
      expect(cookieAvailableToOrigin({ domain: 'example.test', hostOnly: true, secure: false, path }, 'http://example.test')).toBe(received)
    })
})

describe('cookieAvailableToOrigin with a path a page can choose', () => {
  it('still matches other cookies when one cookie\'s path reads as an address', () => {
    expect(cookieAvailableToOrigin({ domain: 'evil.test', hostOnly: true, secure: true, path: '//[' }, 'https://app.example.test')).toBe(false)
    expect(cookieAvailableToOrigin({ domain: 'app.example.test', hostOnly: true, secure: true, path: '/' }, 'https://app.example.test')).toBe(true)
  })
})
