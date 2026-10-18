import { redactNetworkUrl } from '../../../shared/network-details.js'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import type { BrowserStorageOptions, BrowserStorageResult } from '../../../shared/types.js'
import type { CookieWriteHooks } from '../cookie-write-operation.js'
import { boundStorageItems } from '../storage-items.js'
import { executeWebStorage, WebStorageInputError, type WebStorageHooks } from '../web-storage-operation.js'
import { manageCookies } from './cookies.js'
import type { SiteStorageAccess, SiteStorageTab } from './site-storage-access.js'

const MAX_STORAGE_KEY_CHARS = 512
const MAX_STORAGE_INPUT_VALUE_BYTES = 256 * 1024

/** Lists, reads, sets, deletes or clears local storage, session storage or cookies for one HTTP(S) tab's origin. */
export async function manageStorage<Tab extends SiteStorageTab>(access: SiteStorageAccess<Tab>, options: BrowserStorageOptions, cookieWriteHooks?: CookieWriteHooks, webStorageHooks?: WebStorageHooks): Promise<BrowserStorageResult> {
  const tab = access.getTab(options.tabId)
  const action = options.action ?? 'list'
  const pageUrl = new URL(tab.url)
  if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
    if (options.kind !== 'cookies') throw new WebStorageInputError('UNSUPPORTED_SCHEME')
    throw new Error('Site storage is available only for HTTP and HTTPS tabs.')
  }
  const key = options.key
  if ((action === 'get' || action === 'set' || action === 'delete')
    && (key === undefined || (options.kind === 'cookies' && !key.trim()))) {
    if (options.kind !== 'cookies') throw new WebStorageInputError('KEY_REQUIRED')
    throw new TypeError(`key is required to ${action} ${options.kind}`)
  }
  if (key && key.length > MAX_STORAGE_KEY_CHARS) {
    if (options.kind !== 'cookies') throw new WebStorageInputError('KEY_TOO_LARGE')
    throw new TypeError(`Storage keys are limited to ${MAX_STORAGE_KEY_CHARS} characters.`)
  }
  if (action === 'set' && options.value === undefined) {
    if (options.kind !== 'cookies') throw new WebStorageInputError('VALUE_REQUIRED')
    throw new TypeError(`value is required to set ${options.kind}`)
  }
  if (options.value !== undefined && Buffer.byteLength(options.value, 'utf8') > MAX_STORAGE_INPUT_VALUE_BYTES) {
    if (options.kind !== 'cookies') throw new WebStorageInputError('VALUE_TOO_LARGE')
    throw new TypeError('Storage values are limited to 256 KiB.')
  }

  const exactCookie = options.cookieDomain !== undefined || options.cookiePath !== undefined
  if (exactCookie) {
    if (options.kind !== 'cookies' || action !== 'delete') {
      if (options.kind !== 'cookies') throw new WebStorageInputError('COOKIE_SELECTOR_UNSUPPORTED')
      throw new TypeError('cookieDomain and cookiePath are supported only when deleting one cookie')
    }
    if (!options.cookieDomain || !options.cookiePath?.startsWith('/')) {
      throw new TypeError('Exact cookie deletion requires both cookieDomain and a cookiePath starting with /')
    }
  }

  if (options.kind === 'cookies') {
    return manageCookies(access, tab, pageUrl, action, key, options.value, options.includeValues === true, cookieWriteHooks,
      exactCookie ? { domain: options.cookieDomain!, path: options.cookiePath! } : undefined)
  }

  const contents = tab.webContents
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  const assertCurrent = (): void => {
    webStorageHooks?.validate()
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (access.isDestroyed() || access.findTab(tab.id) !== tab || tab.webContents !== contents || contents.isDestroyed()
      || currentWorkspace !== workspace
      || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) {
      throw new Error('Storage context changed. Earlier changes are not rolled back; inspect fresh state before continuing.')
    }
  }
  webStorageHooks?.retainPublication(assertCurrent)
  const storageName = options.kind === 'local-storage' ? 'localStorage' : 'sessionStorage'
  const raw = await executeWebStorage(['set', 'delete', 'clear'].includes(action), assertCurrent, () => contents.executeJavaScript(`(() => {
      if (window.location.href !== ${JSON.stringify(pageUrl.href)}) {
        return { pageChanged: true };
      }
      const storage = window[${JSON.stringify(storageName)}];
      const action = ${JSON.stringify(action)};
      const key = ${JSON.stringify(key)};
      const value = ${JSON.stringify(options.value)};
      let changed = false;
      if (action === 'set') { storage.setItem(key, value); changed = true; }
      else if (action === 'delete') { changed = storage.getItem(key) !== null; storage.removeItem(key); }
      else if (action === 'clear') { changed = storage.length > 0; storage.clear(); }
      const items = [];
      if (action === 'get') {
        const itemValue = storage.getItem(key);
        if (itemValue !== null) items.push([key, itemValue]);
      } else {
        for (let index = 0; index < storage.length; index += 1) {
          const itemKey = storage.key(index);
          if (itemKey !== null) items.push([itemKey, storage.getItem(itemKey) ?? '']);
        }
        items.sort((left, right) => left[0].localeCompare(right[0]));
      }
      return { changed, itemCount: storage.length, items };
    })()`, true), webStorageHooks?.progress) as { pageChanged: true } | { changed: boolean; itemCount: number; items: Array<[string, string]> }
  if ('pageChanged' in raw) throw new Error('The page changed before the storage operation. Run a fresh operation.')
  const bounded = boundStorageItems(raw.items, options.includeValues === true || action === 'get')
  return {
    tabId: tab.id,
    url: redactNetworkUrl(pageUrl.href),
    origin: pageUrl.origin,
    kind: options.kind,
    action,
    itemCount: raw.itemCount,
    items: bounded.items,
    changed: ['set', 'delete', 'clear'].includes(action) ? raw.changed : undefined,
    truncated: bounded.truncated || undefined,
    note: options.kind === 'session-storage'
      ? 'Session storage belongs to this tab. Local storage and cookies are shared by origin only inside this workspace.'
      : 'This storage belongs to the current workspace, so changes are visible to its tabs on this origin but isolated from other workspaces.'
  }
}
