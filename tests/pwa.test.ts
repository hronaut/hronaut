import { describe, expect, it } from 'vitest'
import {
  PWA_INSPECTION_LIMITS,
  normalizeBrowserPwaOptions,
  pwaRegistrationsPageScript,
  sanitizePwaManifest
} from '../src/shared/pwa.js'

describe('offline app inspection options', () => {
  it('normalizes paging and keeps headers opt-in', () => {
    expect(normalizeBrowserPwaOptions({ offset: -10, limit: 500 })).toEqual({
      cacheName: undefined,
      query: '',
      offset: 0,
      limit: PWA_INSPECTION_LIMITS.maxEntries,
      includeHeaders: false
    })
    expect(normalizeBrowserPwaOptions({
      cacheName: 'app-v1',
      query: '/assets/',
      offset: 7.9,
      limit: 2.8,
      includeHeaders: true
    })).toEqual({ cacheName: 'app-v1', query: '/assets/', offset: 7, limit: 2, includeHeaders: true })
  })

  it('bounds website-authored selectors', () => {
    expect(() => normalizeBrowserPwaOptions({ cacheName: '' })).toThrow('cacheName must contain')
    expect(() => normalizeBrowserPwaOptions({ cacheName: 'x'.repeat(PWA_INSPECTION_LIMITS.maxNameChars + 1) })).toThrow('cacheName must contain')
    expect(() => normalizeBrowserPwaOptions({ query: 'x'.repeat(PWA_INSPECTION_LIMITS.maxQueryChars + 1) })).toThrow('query must contain')
  })

  it('generates a read-only registration script', () => {
    const script = pwaRegistrationsPageScript()
    expect(script).toContain('getRegistrations()')
    expect(script).toContain('navigator.serviceWorker.controller')
    expect(script).not.toContain('.unregister(')
    expect(script).not.toContain('.update(')
  })

  it('returns bounded manifest and installability diagnostics without raw source', () => {
    const manifest = sanitizePwaManifest({
      url: 'https://example.test/app.webmanifest?token=private',
      data: JSON.stringify({
        id: '/app?session=private',
        name: 'Example App',
        short_name: 'Example',
        start_url: '/start?access_token=private',
        display: 'standalone',
        icons: [{ src: '/icon.png?api_key=private', sizes: '192x192', type: 'image/png' }],
        shortcuts: [{ name: 'Inbox', url: '/inbox?token=private' }]
      }),
      errors: [{ message: 'Manifest warning token=private', critical: 0, line: 2, column: 3 }]
    }, [{ errorId: 'not-offline-capable', errorArguments: [{ name: 'url', value: '/start?token=private' }] }])

    expect(manifest).toMatchObject({
      url: 'https://example.test/app.webmanifest?token=%5BREDACTED%5D',
      id: 'https://example.test/app?session=%5BREDACTED%5D',
      name: 'Example App',
      shortName: 'Example',
      startUrl: 'https://example.test/start?access_token=%5BREDACTED%5D',
      display: 'standalone',
      icons: [{ url: 'https://example.test/icon.png?api_key=%5BREDACTED%5D', sizes: '192x192', type: 'image/png' }],
      shortcuts: [{ name: 'Inbox', url: 'https://example.test/inbox?token=%5BREDACTED%5D' }],
      parseErrors: [{ message: 'Manifest warning token=[REDACTED]', critical: false, line: 2, column: 3 }],
      installabilityErrors: [{ errorId: 'not-offline-capable', arguments: [{ name: 'url', value: '/start?token=[REDACTED]' }] }]
    })
    expect(manifest).not.toHaveProperty('data')
  })

  it('rejects oversized raw manifest source without parsing it', () => {
    const manifest = sanitizePwaManifest({
      url: 'https://example.test/app.webmanifest',
      data: 'x'.repeat(PWA_INSPECTION_LIMITS.maxManifestSourceBytes + 1)
    })
    expect(manifest).toMatchObject({ url: 'https://example.test/app.webmanifest', truncated: true })
    expect(manifest?.name).toBeUndefined()
  })
})
