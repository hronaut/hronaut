import { redactNetworkUrl } from '../../../shared/network-details.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { BrowserStorageItem, BrowserStorageResult } from '../../../shared/types.js'
import { createCookieWriteOperation, type CookieWriteHooks } from '../cookie-write-operation.js'
import { boundStorageItems } from '../storage-items.js'
import type { SiteStorageAccess, SiteStorageTab } from './site-storage-access.js'

/** The cookie branch of manageStorage, called after it has validated the input. */
export async function manageCookies<Tab extends SiteStorageTab>(
  access: SiteStorageAccess<Tab>,
  tab: Tab,
  pageUrl: URL,
  action: BrowserStorageResult['action'],
  key: string | undefined,
  value: string | undefined,
  includeValues: boolean,
  hooks?: CookieWriteHooks,
  exact?: { domain: string; path: string }
): Promise<BrowserStorageResult> {
  const contents = tab.webContents
  const session = contents.session
  const cookieStore = session.cookies
  // This guard covers document/workspace/control changes, not cookie-session
  // changes after MCP admission. Electron cookie events do not identify their
  // originating operation, so no own-write event exemption is inferred here.
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const assertCurrent = (): void => {
    if (action === 'list' || action === 'get') return
    hooks?.validate()
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || contents.isDestroyed()
      || contents.session !== session || currentWorkspace !== workspace
      || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) {
      throw new Error('Cookie storage context changed. Earlier writes are not rolled back; inspect fresh state before continuing.')
    }
  }
  const operation = createCookieWriteOperation(assertCurrent, hooks?.progress)
  hooks?.retainPublication(assertCurrent)
  assertCurrent()
  const url = pageUrl.href
  const cookies = await cookieStore.get({ url })
  assertCurrent()
  let changed: boolean | undefined
  let expired: string[] | undefined
  if (action === 'set') {
    const protectedMatch = cookies.some((cookie) => cookie.name === key && cookie.httpOnly)
    if (protectedMatch) throw new Error('HttpOnly cookies are protected and cannot be replaced by the storage manager.')
    await operation.write(() => cookieStore.set({
      url: pageUrl.origin,
      name: key!,
      value: value!,
      path: '/',
      secure: pageUrl.protocol === 'https:',
      sameSite: 'lax'
    }))
    changed = true
  } else if (action === 'delete' && exact) {
    const cookie = exactCookie(cookies, { name: key!, ...exact })
    await operation.write(() => expireCookie(cookieStore, cookie))
    const remaining = await cookieStore.get({ url })
    assertCurrent()
    if (remaining.some((cookie) => cookie.name === key && cookie.domain === exact.domain && cookie.path === exact.path)) {
      throw new Error('The selected cookie is still present. Inspect current storage before deciding what to do next; do not automatically repeat the operation.')
    }
    changed = true
  } else if (action === 'delete') {
    const matches = cookies.filter((cookie) => cookie.name === key)
    if (matches.length && matches.every((cookie) => cookie.httpOnly)) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
    expired = await expireListedCookies(cookieStore, cookies, matches, operation)
    // Every match shares its name, domain and path with an HttpOnly cookie.
    if (matches.length && !expired.length) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
  } else if (action === 'clear') {
    expired = await expireListedCookies(cookieStore, cookies, cookies, operation)
  }
  const next = await cookieStore.get({ url })
  assertCurrent()
  if (expired) changed = expired.some((identity) => countIdentity(next, identity) < countIdentity(cookies, identity))
  const selected = action === 'get' ? next.filter((cookie) => cookie.name === key) : next
  const rawItems: Array<[string, string, Omit<BrowserStorageItem, 'key' | 'value' | 'valueBytes'>]> = selected.map((cookie) => [
    cookie.name,
    cookie.value,
    {
      protected: cookie.httpOnly || undefined,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expirationDate,
      secure: cookie.secure,
      sameSite: cookie.sameSite
    }
  ])
  const bounded = boundStorageItems(rawItems, includeValues || action === 'get', true)
  return {
    tabId: tab.id,
    url: redactNetworkUrl(url),
    origin: pageUrl.origin,
    kind: 'cookies',
    action,
    itemCount: next.length,
    items: bounded.items,
    changed,
    truncated: bounded.truncated || undefined,
    note: 'HttpOnly cookie values are protected. Non-HttpOnly cookies and local storage are shared by origin only inside this workspace.'
  }
}

/** A cookie's name, domain and path, which Chromium keeps one cookie of outside partitions. */
function cookieIdentity(cookie: Electron.Cookie): string {
  return `${cookie.name}\u0000${cookie.domain ?? ''}\u0000${cookie.path ?? ''}`
}

function countIdentity(cookies: Electron.Cookie[], identity: string): number {
  return cookies.filter((cookie) => cookieIdentity(cookie) === identity).length
}

// Setting a cookie that has already expired makes Chromium delete the
// unpartitioned cookie of exactly that name, domain and path and store
// nothing. Chromium refuses to replace an HttpOnly cookie with a cookie that is
// not HttpOnly, so this can never delete one. Unlike Chromium's debugging
// connection, it also works while Developer Tools is open.
function expireCookie(cookieStore: Electron.Cookies, cookie: Electron.Cookie): Promise<void> {
  const domain = cookie.domain ?? ''
  return cookieStore.set({
    url: `${cookie.secure ? 'https' : 'http'}://${domain.replace(/^\./, '')}/`,
    name: cookie.name,
    value: '',
    ...(cookie.hostOnly ? {} : { domain }),
    path: cookie.path ?? '/',
    secure: cookie.secure,
    httpOnly: false,
    sameSite: cookie.sameSite,
    expirationDate: 1
  })
}

// Electron's cookies.remove(url, name) deletes every same-name cookie sent to
// that URL, including parent-path variants. Electron listings also include
// partitioned cookies without their partition key, so a second listed cookie of
// the selected identity makes the selection ambiguous. A partitioned cookie
// alone survives expiry, and the caller's fresh read reports it still present.
function exactCookie(listing: Electron.Cookie[], target: { name: string; domain: string; path: string }): Electron.Cookie {
  const listed = listing.filter((cookie) => cookie.name === target.name && cookie.domain === target.domain && cookie.path === target.path)
  const [only] = listed
  if (!only) throw new Error('No cookie for this page matches that exact name, domain and path. List cookies again and use the reported domain and path.')
  if (listed.some((cookie) => cookie.httpOnly)) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
  if (listed.length > 1) throw new Error('More than one cookie has that name, domain and path, for example in another partition. It was not deleted.')
  return only
}

// Name-only deletion and clear expire each selected cookie's exact name, domain
// and path once. Electron's cookies.remove(url, name) would also delete an
// HttpOnly cookie of that name sent to the URL, and a host-only cookie of the
// parent domain that the tab never receives. An identity the listing also
// holds as an HttpOnly cookie, such as a partitioned twin, is left as it is.
// Returns the identities it expired.
async function expireListedCookies(
  cookieStore: Electron.Cookies,
  listing: Electron.Cookie[],
  selected: Electron.Cookie[],
  operation: { write(write: () => Promise<void>): Promise<void> }
): Promise<string[]> {
  const protectedIdentities = new Set(listing.filter((cookie) => cookie.httpOnly).map(cookieIdentity))
  const targets = new Map<string, Electron.Cookie>()
  for (const cookie of selected) {
    const identity = cookieIdentity(cookie)
    if (cookie.domain && cookie.path && !protectedIdentities.has(identity) && !targets.has(identity)) targets.set(identity, cookie)
  }
  for (const cookie of targets.values()) await operation.write(() => expireCookie(cookieStore, cookie))
  return [...targets.keys()]
}
