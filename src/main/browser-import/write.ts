import type { Cookie, Session } from 'electron'
import type { BrowserImportResult } from '../../shared/browser-import.js'
import { cookieDetails, cookieIdentity, sameCookie } from '../browser/workspace-storage.js'

export function domainsOverlap(first: string, second: string): boolean {
  const a = first.replace(/^\./, '').toLowerCase()
  const b = second.replace(/^\./, '').toLowerCase()
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`)
}

/** Caller holds the archived workspace offline with no page/worker writers. */
export async function writeImportedCookies(target: Session, cookies: Cookie[], origins: string[], allowed: (cookie: Cookie) => boolean): Promise<BrowserImportResult & { origins: string[] }> {
  const existing = await target.cookies.get({})
  const knownDomains = [...existing.map(c => c.domain ?? ''), ...origins.map(o => new URL(o).hostname)]
  const blocked = new Set(cookies.filter(c => !allowed(c) || knownDomains.some(d => domainsOverlap(c.domain!, d))).map(c => c.domain!.replace(/^\./, '')))
  const accepted = cookies.filter(c => !blocked.has(c.domain!.replace(/^\./, '')))
  const result: BrowserImportResult & { origins: string[] } = { imported: 0, skipped: cookies.length - accepted.length, failed: 0, recoveryRequired: false, origins: [] }
  const attempted: Cookie[] = []
  try {
    for (const cookie of accepted) { attempted.push(cookie); await target.cookies.set(cookieDetails(cookie)) }
    await target.cookies.flushStore()
    const actual = new Map((await target.cookies.get({})).map(c => [cookieIdentity(c), c]))
    if (accepted.some(c => !sameCookie(actual.get(cookieIdentity(c)), c))) throw new Error('verification')
    result.imported = accepted.length
  } catch {
    // All accepted sites were absent before the import. Expire exact identities,
    // including the attempted write that may have failed after applying.
    for (const cookie of attempted) {
      try { await target.cookies.set({ ...cookieDetails(cookie), expirationDate: 1 }) } catch { result.recoveryRequired = true }
    }
    try {
      await target.cookies.flushStore()
      const remaining = new Set((await target.cookies.get({})).map(cookieIdentity))
      if (attempted.some(c => remaining.has(cookieIdentity(c)))) result.recoveryRequired = true
    } catch { result.recoveryRequired = true }
    result.failed = accepted.length
  }
  if (result.imported || result.recoveryRequired) result.origins = [...new Set(accepted.map(c => `${c.secure ? 'https' : 'http'}://${c.domain!.replace(/^\./, '')}`))]
  return result
}
