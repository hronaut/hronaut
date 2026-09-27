import type { Cookie, Session } from 'electron'
import type { BrowserImportResult } from '../../shared/browser-import.js'
import { cookieDetails, cookieIdentity, sameCookie } from '../browser/workspace-storage.js'

export function domainsOverlap(first: string, second: string): boolean {
  const a = first.replace(/^\./, '').toLowerCase()
  const b = second.replace(/^\./, '').toLowerCase()
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/** Additive import supports live pages. Never remove cookies for rollback:
 * a page or worker may have updated them while the import was running. */
export async function writeImportedCookies(target: Session, cookies: Cookie[], origins: string[], allowed: (cookie: Cookie) => boolean): Promise<BrowserImportResult & { origins: string[] }> {
  const storedDomains = origins.map(origin => new URL(origin).hostname)
  const sites = new Map<string, Cookie[]>()
  for (const cookie of cookies) {
    const domain = cookie.domain!.replace(/^\./, '')
    const site = sites.get(domain) ?? []
    site.push(cookie); sites.set(domain, site)
  }
  const result: BrowserImportResult & { origins: string[] } = { imported: 0, skipped: 0, failed: 0, recoveryRequired: false, origins: [] }
  const attempted = new Map<string, Cookie>()
  for (const [domain, site] of sites) {
    if (site.some(cookie => !allowed(cookie)) || storedDomains.some(known => domainsOverlap(domain, known))) {
      result.skipped += site.length
      continue
    }
    let existing: Cookie[]
    try { existing = await target.cookies.get({}) }
    catch {
      // A failed preflight read cannot leave an import to recover when nothing
      // has been written. Do not imply an uncertain mutation or flush the store.
      if (!attempted.size) {
        result.failed = cookies.length - result.skipped
        return result
      }
      result.recoveryRequired = true
      break
    }
    // Recheck before each site. Exclude only our own unchanged writes so a
    // newly signed-in page wins, including parent/subdomain cookie overlap.
    if (existing.some(cookie => {
      const ownWrite = attempted.get(cookieIdentity(cookie))
      return (!ownWrite || !sameCookie(cookie, ownWrite)) && domainsOverlap(domain, cookie.domain ?? '')
    })) {
      result.skipped += site.length
      continue
    }
    for (const cookie of site) {
      attempted.set(cookieIdentity(cookie), cookie)
      try { await target.cookies.set(cookieDetails(cookie)) }
      catch { /* Readback determines whether an ambiguous write actually applied. */ }
    }
  }
  if (!attempted.size) return result
  try { await target.cookies.flushStore() } catch { result.recoveryRequired = true }
  let verified: Cookie[] = []
  try {
    const actual = new Map((await target.cookies.get({})).map(cookie => [cookieIdentity(cookie), cookie]))
    verified = [...attempted.values()].filter(cookie => sameCookie(actual.get(cookieIdentity(cookie)), cookie))
    if (!result.recoveryRequired) result.imported = verified.length
  } catch { result.recoveryRequired = true }
  result.failed = cookies.length - result.skipped - result.imported
  const retained = result.recoveryRequired ? [...attempted.values()] : verified
  result.origins = [...new Set(retained.map(cookie => `${cookie.secure ? 'https' : 'http'}://${cookie.domain!.replace(/^\./, '')}`))]
  return result
}
