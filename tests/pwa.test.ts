import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import {
  PWA_INSPECTION_LIMITS,
  normalizeBrowserPwaOptions,
  pwaRegistrationsPageScript,
  sanitizePwaHeaders,
  sanitizePwaManifest
} from '../src/shared/pwa.js'

describe('offline app inspection options', () => {
  it('redacts cache headers using their full names before display truncation', () => {
    const name = `x-${'a'.repeat(PWA_INSPECTION_LIMITS.maxHeaderNameChars)}-token`
    expect(sanitizePwaHeaders([{ name, value: 'synthetic-secret' }])).toEqual({
      [name.slice(0, PWA_INSPECTION_LIMITS.maxHeaderNameChars)]: '[REDACTED]'
    })
  })

  it('preserves prototype-named cache headers and repeated values as ordinary data', () => {
    const headers = sanitizePwaHeaders([
      { name: '__proto__', value: 'first' }, { name: '__proto__', value: 'second' },
      { name: 'constructor', value: 'third' }
    ])
    expect(Object.getPrototypeOf(headers)).toBeNull()
    expect(JSON.parse(JSON.stringify(headers))).toEqual({ ['__proto__']: ['first', 'second'], constructor: 'third' })
  })

  it('keeps cache header output within its total character budget', () => {
    const headers = sanitizePwaHeaders(Array.from({ length: 60 }, (_, i) => ({ name: `x-${i}`, value: 'v'.repeat(2_000) })))
    const chars = Object.entries(headers).reduce((total, [name, value]) => total + name.length + String(value).length, 0)
    expect(chars).toBe(PWA_INSPECTION_LIMITS.maxHeaderCharsTotal)
    expect(Object.values(headers).every(value => value.length <= PWA_INSPECTION_LIMITS.maxHeaderValueChars)).toBe(true)
  })

  it('resolves and redacts long protocol-relative manifest URLs before bounding them', () => {
    const url = `//synthetic-private-${'x'.repeat(PWA_INSPECTION_LIMITS.maxUrlChars + 100)}@example.test/app?token=private`
    const safe = 'https://%5BREDACTED%5D@example.test/app?token=%5BREDACTED%5D'
    const manifest = sanitizePwaManifest({
      url: 'https://example.test/app.webmanifest',
      manifest: { id: url, start_url: url, scope: url, icons: [{ src: url }], shortcuts: [{ name: 'App', url }] }
    })
    expect(manifest).toMatchObject({
      id: safe, startUrl: safe, scope: safe, icons: [{ url: safe }], shortcuts: [{ name: 'App', url: safe }]
    })
    expect(JSON.stringify(manifest)).not.toContain('synthetic-private')
  })

  it('resolves relative fields against the complete manifest URL while bounding public URLs', () => {
    const url = `https://example.test/parent/${'x'.repeat(PWA_INSPECTION_LIMITS.maxUrlChars + 100)}/manifest.json`
    const manifest = sanitizePwaManifest({ url, manifest: { start_url: '../start', icons: [{ src: 'icon.png' }] } })
    expect(manifest?.startUrl).toBe('https://example.test/parent/start')
    expect(manifest?.url).toHaveLength(PWA_INSPECTION_LIMITS.maxUrlChars)
    expect(manifest?.icons[0]?.url).toBe(new URL('icon.png', url).href.slice(0, PWA_INSPECTION_LIMITS.maxUrlChars))
  })

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

  it.each([49, 50, 51])('reports registration truncation accurately for %i registrations', async (count) => {
    const registrations = Array.from({ length: count }, (_, index) => ({
      scope: `https://example.test/app-${index}/`
    }))
    const report = await runInNewContext(pwaRegistrationsPageScript(), {
      navigator: { serviceWorker: { getRegistrations: async () => registrations } }
    }) as { registrations: Array<{ scope: string }>; truncated: boolean }
    expect(report.registrations.map(registration => registration.scope)).toEqual(
      registrations.slice(0, PWA_INSPECTION_LIMITS.maxRegistrations).map(registration => registration.scope)
    )
    expect(report.truncated).toBe(count > PWA_INSPECTION_LIMITS.maxRegistrations)
  })

  it.each([19, 20, 21])('reports omitted installability arguments accurately for %i arguments', (count) => {
    const errorArguments = Array.from({ length: count }, (_, index) => ({ name: `field-${index}`, value: 'value' }))
    const manifest = sanitizePwaManifest({}, [{ errorId: 'installability-error', errorArguments }])
    expect(manifest?.installabilityErrors[0]?.arguments).toEqual(
      errorArguments.slice(0, PWA_INSPECTION_LIMITS.maxManifestErrorArguments)
    )
    expect(manifest?.truncated ?? false).toBe(count > PWA_INSPECTION_LIMITS.maxManifestErrorArguments)
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
