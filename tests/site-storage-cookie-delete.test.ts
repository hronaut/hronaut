import type { Cookie, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { manageCookies } from '../src/main/browser/site-storage/cookies.js'
import type { SiteStorageAccess, SiteStorageTab } from '../src/main/browser/site-storage/site-storage-access.js'

interface StoredCookie { name: string; value: string; domain: string; path: string; httpOnly: boolean; partitionKey?: unknown }

const PAGE = new URL('https://app.example.test/checkout/page')

/**
 * A tab whose cookie store behaves like Chromium's for the calls site storage makes: the listing holds the cookies the
 * page receives, Network.deleteCookies deletes exactly the unpartitioned cookies of a name, domain and path, and
 * cookies.remove(url, name) deletes every cookie of that name sent to the URL, HttpOnly ones included.
 */
function cookieTab(stored: StoredCookie[]) {
  const sentTo = (url: URL, cookie: StoredCookie): boolean => cookie.partitionKey === undefined
    && (cookie.domain.startsWith('.') ? `.${url.hostname}`.endsWith(cookie.domain) : url.hostname === cookie.domain)
    && (url.pathname === cookie.path || url.pathname.startsWith(cookie.path.endsWith('/') ? cookie.path : `${cookie.path}/`))
  const listing = (url: URL): Cookie[] => stored.filter((cookie) => sentTo(url, cookie)).map((cookie) => ({
    name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, httpOnly: cookie.httpOnly,
    hostOnly: !cookie.domain.startsWith('.'), secure: true, session: true, sameSite: 'lax'
  }))
  const remove = vi.fn(async (url: string, name: string) => {
    const target = new URL(url)
    for (const cookie of stored.filter((candidate) => candidate.name === name && sentTo(target, candidate))) stored.splice(stored.indexOf(cookie), 1)
  })
  const sendCommand = vi.fn(async (method: string, params?: { name: string; domain: string; path: string }) => {
    if (method === 'Network.getAllCookies') return { cookies: stored.map((cookie) => ({ ...cookie })) }
    if (method !== 'Network.deleteCookies') throw new Error(`Unexpected ${method}`)
    for (const cookie of stored.filter((candidate) => candidate.partitionKey === undefined && candidate.name === params!.name
      && candidate.domain === params!.domain && candidate.path === params!.path)) stored.splice(stored.indexOf(cookie), 1)
    return {}
  })
  const session = { cookies: { get: vi.fn(async ({ url }: { url: string }) => listing(new URL(url))), remove, set: vi.fn() } }
  const webContents = { session, isDestroyed: () => false, debugger: { sendCommand } } as unknown as WebContents
  const tab: SiteStorageTab = { id: 'tab-1', url: PAGE.href, webContents, storageComparisonGeneration: 0 }
  const context = { tabId: 'tab-1', workspaceId: null, navigationGeneration: 0, observationGeneration: 0, humanInteractionGeneration: 0, snapshotFormatVersion: 1 }
  const access: SiteStorageAccess<SiteStorageTab> = {
    getTab: () => tab,
    findTab: (id) => id === tab.id ? tab : undefined,
    findWorkspace: () => undefined,
    inspectionPermission: () => undefined,
    isDestroyed: () => false,
    snapshotDeltaContext: () => context,
    withDebugger: async (_contents, operation) => operation()
  }
  const remaining = (): string[] => stored.map((cookie) => `${cookie.name}=${cookie.value}@${cookie.domain}${cookie.path}`).sort()
  return { access, tab, remove, sendCommand, remaining }
}

function storedCookies(): StoredCookie[] {
  return [
    { name: 'token', value: 'session-secret', domain: 'app.example.test', path: '/', httpOnly: true },
    { name: 'token', value: 'guest', domain: 'app.example.test', path: '/checkout', httpOnly: false },
    { name: 'pref', value: 'shared', domain: '.example.test', path: '/', httpOnly: false },
    // The parent domain's own cookie, which the page at app.example.test never receives.
    { name: 'pref', value: 'apex-session', domain: 'example.test', path: '/', httpOnly: true },
    { name: 'pref', value: 'partitioned', domain: '.example.test', path: '/', httpOnly: false, partitionKey: { topLevelSite: 'https://top.test' } }
  ]
}

describe('site storage cookie deletion', () => {
  it('deletes only the non-HttpOnly cookies of a name that the page receives', async () => {
    const { access, tab, remove, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(access, tab, PAGE, 'delete', 'token', undefined, false)
    expect(result.changed).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(remaining()).toEqual([
      'pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'pref=shared@.example.test/', 'token=session-secret@app.example.test/'
    ])
  })

  it('leaves the parent domain’s own cookie and partitioned cookies when deleting a parent-domain cookie', async () => {
    const { access, tab, remaining } = cookieTab(storedCookies())
    await manageCookies(access, tab, PAGE, 'delete', 'pref', undefined, false)
    expect(remaining()).toEqual([
      'pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'token=guest@app.example.test/checkout', 'token=session-secret@app.example.test/'
    ])
  })

  it('clears every non-HttpOnly cookie the page receives and nothing else', async () => {
    const { access, tab, remove, remaining } = cookieTab(storedCookies())
    const result = await manageCookies(access, tab, PAGE, 'clear', undefined, undefined, false)
    expect(result.changed).toBe(true)
    expect(remove).not.toHaveBeenCalled()
    expect(remaining()).toEqual(['pref=apex-session@example.test/', 'pref=partitioned@.example.test/', 'token=session-secret@app.example.test/'])
  })

  it('leaves a cookie whose name, domain and path the store also holds as an HttpOnly cookie', async () => {
    const stored = [
      { name: 'token', value: 'guest', domain: 'app.example.test', path: '/checkout', httpOnly: false },
      { name: 'token', value: 'session-secret', domain: 'app.example.test', path: '/checkout', httpOnly: true }
    ]
    const { access, tab, sendCommand, remaining } = cookieTab(stored)
    const result = await manageCookies(access, tab, PAGE, 'clear', undefined, undefined, false)
    expect(result.changed).toBe(false)
    expect(sendCommand).not.toHaveBeenCalledWith('Network.deleteCookies', expect.anything())
    expect(remaining()).toEqual(['token=guest@app.example.test/checkout', 'token=session-secret@app.example.test/checkout'])
  })
})
