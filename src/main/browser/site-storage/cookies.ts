import type { WebContents } from 'electron'
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
    await deleteExactCookie(access, contents, cookies, { name: key!, ...exact }, operation, assertCurrent)
    const remaining = await cookieStore.get({ url })
    assertCurrent()
    if (remaining.some((cookie) => cookie.name === key && cookie.domain === exact.domain && cookie.path === exact.path)) {
      throw new Error('The selected cookie is still present. Inspect current storage before deciding what to do next; do not automatically repeat the operation.')
    }
    changed = true
  } else if (action === 'delete') {
    const matches = cookies.filter((cookie) => cookie.name === key)
    const editable = matches.filter((cookie) => !cookie.httpOnly)
    if (matches.length && !editable.length) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
    changed = await deleteListedCookies(access, contents, editable, operation, assertCurrent)
  } else if (action === 'clear') {
    changed = await deleteListedCookies(access, contents, cookies.filter((cookie) => !cookie.httpOnly), operation, assertCurrent)
  }
  const next = await cookieStore.get({ url })
  assertCurrent()
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

// Electron's cookies.remove(url, name) deletes every same-name cookie sent to
// that URL, including parent-path variants. CDP Network.deleteCookies matches
// name, domain and path exactly and, without a partition key, only
// unpartitioned cookies. Electron listings omit partition keys, so the
// complete store is checked for one unpartitioned identity before dispatch.
async function deleteExactCookie<Tab extends SiteStorageTab>(
  access: SiteStorageAccess<Tab>,
  contents: WebContents,
  applicable: Electron.Cookie[],
  target: { name: string; domain: string; path: string },
  operation: { write(write: () => Promise<void>): Promise<void> },
  assertCurrent: () => void
): Promise<void> {
  const sameIdentity = (cookie: { name: string; domain?: string; path?: string }): boolean =>
    cookie.name === target.name && cookie.domain === target.domain && cookie.path === target.path
  const listed = applicable.filter(sameIdentity)
  if (!listed.length) throw new Error('No cookie for this page matches that exact name, domain and path. List cookies again and use the reported domain and path.')
  if (listed.some((cookie) => cookie.httpOnly)) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
  if (listed.length > 1) throw new Error('More than one cookie has that name, domain and path, for example in another partition. It was not deleted.')
  await access.withDebugger(contents, async () => {
    assertCurrent()
    const store = await contents.debugger.sendCommand('Network.getAllCookies') as {
      cookies?: Array<{ name: string; domain: string; path: string; httpOnly?: boolean; partitionKey?: unknown }>
    }
    assertCurrent()
    const stored = (store.cookies ?? []).filter(sameIdentity)
    const [only] = stored
    if (stored.length !== 1 || !only) throw new Error('The selected cookie identity is ambiguous or no longer present. It was not deleted.')
    if (only.partitionKey !== undefined) throw new Error('Partitioned cookies are not supported by exact deletion. It was not deleted.')
    if (only.httpOnly) throw new Error('HttpOnly cookies are protected and cannot be deleted by the storage manager.')
    await operation.write(async () => {
      await contents.debugger.sendCommand('Network.deleteCookies', { name: target.name, domain: target.domain, path: target.path })
    })
  }, assertCurrent)
}

// Name-only deletion and clear delete each listed cookie by its exact name,
// domain and path too. Electron's cookies.remove(url, name) would also delete
// an HttpOnly cookie of that name sent to the URL, and a host-only cookie of
// the parent domain that the tab never receives. An identity the complete store
// also holds as an HttpOnly cookie is left as it is; partitioned cookies are
// never matched without a partition key. Returns whether it deleted any.
async function deleteListedCookies<Tab extends SiteStorageTab>(
  access: SiteStorageAccess<Tab>,
  contents: WebContents,
  listed: Electron.Cookie[],
  operation: { write(write: () => Promise<void>): Promise<void> },
  assertCurrent: () => void
): Promise<boolean> {
  if (!listed.length) return false
  return access.withDebugger(contents, async () => {
    assertCurrent()
    const store = await contents.debugger.sendCommand('Network.getAllCookies') as {
      cookies?: Array<{ name: string; domain: string; path: string; httpOnly?: boolean; partitionKey?: unknown }>
    }
    assertCurrent()
    let deleted = false
    for (const cookie of listed) {
      const target = { name: cookie.name, domain: cookie.domain ?? '', path: cookie.path ?? '/' }
      const stored = (store.cookies ?? []).filter((candidate) => candidate.partitionKey === undefined
        && candidate.name === target.name && candidate.domain === target.domain && candidate.path === target.path)
      if (!target.domain || !stored.length || stored.some((candidate) => candidate.httpOnly)) continue
      await operation.write(async () => {
        await contents.debugger.sendCommand('Network.deleteCookies', target)
      })
      deleted = true
    }
    return deleted
  }, assertCurrent)
}
