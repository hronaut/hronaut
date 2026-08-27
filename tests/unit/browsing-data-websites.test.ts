import { describe, expect, it } from 'vitest'
import { buildBrowsingDataWebsiteInventory } from '../../src/main/browsing-data-websites.js'

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
      permissions: [{ origin: 'https://camera.test', permission: 'media', decision: 'deny' }],
      tabs: [{ id: 'tab', title: 'Open tab', url: 'https://open.test/path', loading: false, canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false }]
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
        { id: 'http', title: 'HTTP', url: 'http://secure.test/', loading: false, canGoBack: false, canGoForward: false, active: false, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false },
        { id: 'file', title: 'File', url: 'file:///tmp/test', loading: false, canGoBack: false, canGoForward: false, active: true, pinned: false, sleeping: false, humanInteractionLocked: false, preserveDiagnosticLogs: true, zoomPercent: 100, audible: false, muted: false, devToolsOpen: false }
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
