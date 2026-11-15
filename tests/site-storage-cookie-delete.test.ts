import type { Cookie, CookiesSetDetails, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { manageCookies } from '../src/main/browser/site-storage/cookies.js'
import type { Browser } from '../src/main/browser/browser.js'
import type { BrowserTab } from '../src/main/browser/browser-tab.js'

// The debugger lease goes to the fake browser's, so a call to it is seen.
vi.mock('../src/main/browser/debugger-lease/debugger-lease.js', () => ({
  withDebugger: (browser: { withDebugger: (...args: unknown[]) => unknown }, ...args: unknown[]) => browser.withDebugger(...args)
}))

interface StoredCookie { name: string; value: string; domain: string; path: string; httpOnly: boolean; secure?: true; partitioned?: true }

const PAGE = new URL('https://app.example.test/checkout/page')

/**
 * A tab whose cookie store behaves like Chromium's for the calls site storage makes: a listing holds the cookies the
 * page receives, partitioned ones included without their partition key; setting an already expired cookie deletes the
 * unpartitioned cookie of exactly that name, domain and path, and refuses to replace an HttpOnly one; and
 * cookies.remove(url, name) deletes every cookie of that name sent to the URL, HttpOnly ones included.
 */
function cookieTab(stored: StoredCookie[]) {
  const sentTo = (url: URL, cookie: StoredCookie): boolean =>
    (cookie.domain.startsWith('.') ? `.${url.hostname}`.endsWith(cookie.domain) : url.hostname === cookie.domain)
    && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))
  const listing = (url: URL): Cookie[] => stored.filter((cookie) => sentTo(url, cookie)).map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly,
    hostOnly: !cookie.domain.startsWith('.'), secure: cookie.secure ?? false, session: true, sameSite: 'lax'
  }))
  const remove = vi.fn(async (url: string, name: string) => {
    const target = new URL(url)
    for (const cookie of stored.filter((candidate) => candidate.name === name && sentTo(target, candidate))) stored.splice(stored.indexOf(cookie), 1)
  })
  const set = vi.fn(async (details: CookiesSetDetails) => {
    if ((details.expirationDate ?? Infinity) > Date.now() / 1000) throw new Error('Only expiry is modeled')
    if (!details.name && !details.value) throw new Error('Failed to set cookie - The cookie has neither a name nor a value')
    if (!details.url.startsWith('https:') && stored.some((cookie) => cookie.name === details.name && cookie.secure)) {
      throw new Error('Failed to set cookie - The cookie would have overwritten a Secure cookie')
    }
    const domain = details.domain ?? new URL(details.url).hostname
    const existing = stored.find((cookie) => !cookie.partitioned && cookie.name === details.name && cookie.domain === domain && cookie.path === details.path)
    if (existing?.httpOnly && !details.httpOnly) throw new Error('Failed to set cookie - The cookie would have overwritten an HttpOnly cookie')
    if (existing) stored.splice(stored.indexOf(existing), 1)
  })
  const session = { cookies: { get: vi.fn(async ({ url }: { url: string }) => listing(new URL(url))), remove, set } }
  const webContents = { session, isDestroyed: () => false } as unknown as WebContents
  const tab = { id: 'tab-1', url: PAGE.href, webContents, storageComparisonGeneration: 0 } as unknown as BrowserTab
  const context = { tabId: 'tab-1', workspaceId: null, navigationGeneration: 0, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  // Developer Tools is open for the tab: nothing here may need the debugging connection.
  const withDebugger = vi.fn(async () => { throw new Error('Close Developer Tools for this tab, then try again.') })
  const browser = {
    tabs: new Map([[tab.id, tab]]),
    mcpTabGroups: new Map(),
    inspectionPermissions: new WeakMap(),
    destroyed: false,
    snapshotDeltaContext: () => context,
    withDebugger
  } as unknown as Browser
  const remaining = (): string[] => stored.map((cookie) => `${cookie.name}=${cookie.value}@${cookie.domain}${cookie.path}`).sort()
  return { browser, tab, remove, set, withDebugger, remaining }
}

function storedCookies(): StoredCookie[] {
  return [
    { name: 'token', value: 'session-secret', domain: 'app.example.test', path: '/', httpOnly: true },
    { name: 'token', value: 'guest', domain: 'app.example.test', path: '/checkout', httpOnly: false },
    { name: 'pref', value: 'shared', domain: '.example.test', path: '/', httpOnly: false },
    // The parent domain's own cookie, which the page at app.example.test never receives.
    { name: 'pref', value: 'apex-session', domain: 'example.test', path: '/', httpOnly: true },
    { name: 'pref', value: 'partitioned', domain: '.example.test', path: '/', httpOnly: false, partitioned: true }
  ]
}

describe('site storage cookie deletion', () => {
  it('deletes only the non-HttpOnly cookies of a name that the page receives, with Developer Tools open', async () => {
    const { browser, tab, remove, withDebugger, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(browser, tab, PAGE, 'delete', 'token', undefined, false)
    expect(result.changed).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(withDebugger).not.toHaveBeenCalled()
    expect(remaining()).toEqual([
      'pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'pref=shared@.example.test/', 'token=session-secret@app.example.test/'
    ])
  })

  it('leaves the parent domain’s own cookie and partitioned cookies when deleting a parent-domain cookie', async () => {
    const { browser, tab, set, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(browser, tab, PAGE, 'delete', 'pref', undefined, false)
    expect(result.changed).toBe(true)
    // The listing holds the shared cookie and its partitioned twin; their one identity is expired once.
    expect(set).toHaveBeenCalledOnce()
    expect(remaining()).toEqual([
      'pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'token=guest@app.example.test/checkout', 'token=session-secret@app.example.test/'
    ])
  })

  it('clears every non-HttpOnly cookie the page receives and nothing else', async () => {
    const { browser, tab, remove, withDebugger, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(browser, tab, PAGE, 'clear', undefined, undefined, false)
    expect(result.changed).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(withDebugger).not.toHaveBeenCalled()
    expect(remaining()).toEqual(['pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'token=session-secret@app.example.test/'])
  })

  it('leaves a cookie whose name, domain and path the listing also holds as an HttpOnly cookie', async () => {
    const stored = (): StoredCookie[] => [
      { name: 'token', value: 'guest', domain: 'app.example.test', path: '/checkout', httpOnly: false },
      { name: 'token', value: 'session-secret', domain: 'app.example.test', path: '/checkout', httpOnly: true, partitioned: true }
    ]
    const cleared = cookieTab(stored())
    expect((await manageCookies(cleared.browser, cleared.tab, PAGE, 'clear', undefined, undefined, false)).changed).toBe(false)
    expect(cleared.set).not.toHaveBeenCalled()
    expect(cleared.remaining()).toEqual(['token=guest@app.example.test/checkout', 'token=session-secret@app.example.test/checkout'])
    const deleted = cookieTab(stored())
    await expect(manageCookies(deleted.browser, deleted.tab, PAGE, 'delete', 'token', undefined, false)).rejects.toThrow('HttpOnly cookies are protected')
    expect(deleted.set).not.toHaveBeenCalled()
  })

  it('clears a cookie without a name, and one whose name a Secure cookie on another path also has', async () => {
    const { browser, tab, remaining } = cookieTab([
      { name: '', value: 'nameless', domain: 'app.example.test', path: '/', httpOnly: false },
      { name: 'tok', value: 'plain', domain: 'app.example.test', path: '/checkout', httpOnly: false },
      { name: 'tok', value: 'secure', domain: 'app.example.test', path: '/', httpOnly: false, secure: true }
    ])
    const result = await manageCookies(browser, tab, PAGE, 'clear', undefined, undefined, false)
    expect(result.changed).toBe(true)
    expect(remaining()).toEqual([])
  })

  it('deletes one exact cookie with Developer Tools open', async () => {
    const { browser, tab, withDebugger, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(browser, tab, PAGE, 'delete', 'token', undefined, false, undefined, { domain: 'app.example.test', path: '/checkout' })
    expect(result.changed).toBe(true)
    expect(withDebugger).not.toHaveBeenCalled()
    expect(remaining()).not.toContain('token=guest@app.example.test/checkout')
    expect(remaining()).toContain('token=session-secret@app.example.test/')
  })

  it('reports an exact partitioned cookie as still present, and rejects one with a partitioned twin before writing', async () => {
    const partitionedOnly = cookieTab([{ name: 'pref', value: 'partitioned', domain: '.example.test', path: '/', httpOnly: false, partitioned: true }])
    await expect(manageCookies(partitionedOnly.browser, partitionedOnly.tab, PAGE, 'delete', 'pref', undefined, false, undefined, { domain: '.example.test', path: '/' }))
      .rejects.toThrow('The selected cookie is still present')
    expect(partitionedOnly.remaining()).toEqual(['pref=partitioned@.example.test/'])
    const twin = cookieTab(storedCookies())
    await expect(manageCookies(twin.browser, twin.tab, PAGE, 'delete', 'pref', undefined, false, undefined, { domain: '.example.test', path: '/' }))
      .rejects.toThrow('More than one cookie')
    expect(twin.set).not.toHaveBeenCalled()
  })
})
