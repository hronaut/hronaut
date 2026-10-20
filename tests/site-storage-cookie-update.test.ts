import type { Cookie, CookiesSetDetails, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { manageCookies } from '../src/main/browser/site-storage/cookies.js'
import { manageStorage } from '../src/main/browser/site-storage/manage-storage.js'
import type { SiteStorageAccess, SiteStorageTab } from '../src/main/browser/site-storage/site-storage-access.js'

interface StoredCookie {
  name: string
  value: string
  domain: string
  path: string
  httpOnly: boolean
  secure?: boolean
  sameSite?: Cookie['sameSite']
  expirationDate?: number
  partitioned?: true
}

const PAGE = new URL('https://app.example.test/app/page')

/**
 * A tab whose cookie store behaves like Chromium's for a set: it replaces the unpartitioned cookie of exactly that
 * name, domain (host-only when no domain is given) and path, refuses to replace an HttpOnly one, and otherwise adds a
 * cookie. A listing holds the cookies the page receives, partitioned ones without their partition key.
 */
function cookieTab(stored: StoredCookie[]) {
  const sentTo = (url: URL, cookie: StoredCookie): boolean =>
    (cookie.domain.startsWith('.') ? `.${url.hostname}`.endsWith(cookie.domain) : url.hostname === cookie.domain)
    && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))
  const listing = (url: URL): Cookie[] => stored.filter((cookie) => sentTo(url, cookie)).map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly,
    hostOnly: !cookie.domain.startsWith('.'), secure: cookie.secure ?? false, sameSite: cookie.sameSite ?? 'lax',
    session: cookie.expirationDate === undefined,
    ...(cookie.expirationDate === undefined ? {} : { expirationDate: cookie.expirationDate })
  }))
  const set = vi.fn(async (details: CookiesSetDetails) => {
    const domain = details.domain ?? new URL(details.url).hostname
    const existing = stored.find((cookie) => !cookie.partitioned && cookie.name === details.name && cookie.domain === domain && cookie.path === details.path)
    if (existing?.httpOnly && !details.httpOnly) throw new Error('Failed to set cookie - The cookie would have overwritten an HttpOnly cookie')
    if (existing) stored.splice(stored.indexOf(existing), 1)
    stored.push({
      name: details.name!, value: details.value!, domain, path: details.path!, httpOnly: details.httpOnly ?? false,
      secure: details.secure, sameSite: details.sameSite, expirationDate: details.expirationDate
    })
  })
  const session = { cookies: { get: vi.fn(async ({ url }: { url: string }) => listing(new URL(url))), remove: vi.fn(), set } }
  const webContents = { session, isDestroyed: () => false } as unknown as WebContents
  const tab: SiteStorageTab = { id: 'tab-1', url: PAGE.href, webContents, storageComparisonGeneration: 0 }
  const context = { tabId: 'tab-1', workspaceId: null, navigationGeneration: 0, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const access: SiteStorageAccess<SiteStorageTab> = {
    getTab: () => tab,
    findTab: (id) => id === tab.id ? tab : undefined,
    findWorkspace: () => undefined,
    inspectionPermission: () => undefined,
    isDestroyed: () => false,
    snapshotDeltaContext: () => context,
    withDebugger: vi.fn(async () => { throw new Error('No debugger in this test') })
  }
  return { access, tab, set, stored }
}

const EXPIRY = 1_900_000_000

function storedCookies(): StoredCookie[] {
  return [
    { name: 'pref', value: 'app', domain: '.example.test', path: '/app', httpOnly: false, secure: true, sameSite: 'strict', expirationDate: EXPIRY },
    { name: 'pref', value: 'root', domain: 'app.example.test', path: '/', httpOnly: false },
    { name: 'sid', value: 'session-secret', domain: 'app.example.test', path: '/', httpOnly: true },
    { name: 'sid', value: 'script', domain: 'app.example.test', path: '/app', httpOnly: false }
  ]
}

describe('site storage cookie update', () => {
  it('gives only the selected cookie the new value and keeps its domain, path, Secure, SameSite and expiry', async () => {
    const { access, tab, set, stored } = cookieTab(storedCookies())
    const result = await manageCookies(access, tab, PAGE, 'set', 'pref', 'updated', true, undefined, { domain: '.example.test', path: '/app' })

    expect(result.changed).toBe(true)
    expect(set).toHaveBeenCalledExactlyOnceWith({
      url: 'https://example.test/', name: 'pref', value: 'updated', domain: '.example.test', path: '/app',
      secure: true, httpOnly: false, sameSite: 'strict', expirationDate: EXPIRY
    })
    expect(stored.filter((cookie) => cookie.name === 'pref').map(({ value, domain, path }) => `${value}@${domain}${path}`).sort())
      .toEqual(['root@app.example.test/', 'updated@.example.test/app'])
  })

  it('updates a host-only session cookie without giving it a domain or an expiry', async () => {
    const { access, tab, set, stored } = cookieTab(storedCookies())
    await manageCookies(access, tab, PAGE, 'set', 'pref', 'changed', true, undefined, { domain: 'app.example.test', path: '/' })

    const details = set.mock.calls[0]![0]
    expect(details).not.toHaveProperty('domain')
    expect(details).not.toHaveProperty('expirationDate')
    expect(stored.filter((cookie) => cookie.name === 'pref')).toHaveLength(2)
  })

  it('updates a script cookie beside an HttpOnly cookie of the same name on another path', async () => {
    const { access, tab, stored } = cookieTab(storedCookies())
    await manageCookies(access, tab, PAGE, 'set', 'sid', 'changed', true, undefined, { domain: 'app.example.test', path: '/app' })

    expect(stored.filter((cookie) => cookie.name === 'sid').map(({ value, path }) => `${value}${path}`).sort()).toEqual(['changed/app', 'session-secret/'])
  })

  it('refuses an HttpOnly, missing or ambiguous cookie before writing anything', async () => {
    const httpOnly = cookieTab(storedCookies())
    await expect(manageCookies(httpOnly.access, httpOnly.tab, PAGE, 'set', 'sid', 'x', true, undefined, { domain: 'app.example.test', path: '/' }))
      .rejects.toThrow('HttpOnly cookies are protected and cannot be replaced by the storage manager.')
    expect(httpOnly.set).not.toHaveBeenCalled()

    const missing = cookieTab(storedCookies())
    await expect(manageCookies(missing.access, missing.tab, PAGE, 'set', 'pref', 'x', true, undefined, { domain: 'example.test', path: '/app' }))
      .rejects.toThrow('No cookie for this page matches that exact name, domain and path.')
    expect(missing.set).not.toHaveBeenCalled()

    const ambiguous = cookieTab([...storedCookies(), { name: 'pref', value: 'partitioned', domain: '.example.test', path: '/app', httpOnly: false, partitioned: true }])
    await expect(manageCookies(ambiguous.access, ambiguous.tab, PAGE, 'set', 'pref', 'x', true, undefined, { domain: '.example.test', path: '/app' }))
      .rejects.toThrow('More than one cookie has that name, domain and path, for example in another partition. It was not replaced.')
    expect(ambiguous.set).not.toHaveBeenCalled()
  })

  it('accepts a cookie selector for set and still refuses it for other actions', async () => {
    const { access, set } = cookieTab(storedCookies())
    await manageStorage(access, { tabId: 'tab-1', kind: 'cookies', action: 'set', key: 'pref', value: 'v', cookieDomain: '.example.test', cookiePath: '/app' })
    expect(set).toHaveBeenCalledOnce()

    await expect(manageStorage(access, { tabId: 'tab-1', kind: 'cookies', action: 'get', key: 'pref', cookieDomain: '.example.test', cookiePath: '/app' }))
      .rejects.toThrow('cookieDomain and cookiePath are supported only when deleting or setting one cookie')
    await expect(manageStorage(access, { tabId: 'tab-1', kind: 'cookies', action: 'set', key: 'pref', value: 'v', cookieDomain: '.example.test' }))
      .rejects.toThrow('Selecting one cookie requires both cookieDomain and a cookiePath starting with /')
  })
})
