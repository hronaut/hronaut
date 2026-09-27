import { describe, expect, it, vi } from 'vitest'
import type { Cookie, CookiesSetDetails, Session } from 'electron'
vi.mock('electron', () => ({ session: {}, WebContentsView: class {} }))
import { writeImportedCookies } from '../src/main/browser-import/write.js'
function cookie(domain: string, value = 'new'): Cookie { return { domain, value, name: 'session', path: '/', secure: true, httpOnly: true, hostOnly: !domain.startsWith('.'), session: true, sameSite: 'lax' } }
function jar(initial: Cookie[] = []) {
  const cookies = new Map(initial.map(c => [c.domain!, { ...c }]))
  const target = {
    cookies: {
      get: vi.fn(async () => [...cookies.values()].map(c => ({ ...c }))), flushStore: vi.fn(async () => {}),
      set: vi.fn(async (details: CookiesSetDetails) => {
        const domain = details.domain ?? new URL(details.url).hostname
        if (details.expirationDate === 1) cookies.delete(domain)
        else cookies.set(domain, { ...cookie(domain), ...details })
      })
    }
  }
  return { cookies, target, session: target as unknown as Session }
}
describe('workspace cookie writes', () => {
  it('skips whole overlapping sites with existing cookies or storage and policy-blocked sites', async () => {
    const { cookies, session } = jar([cookie('.existing.test', 'keep')])
    const result = await writeImportedCookies(session, [cookie('app.existing.test'), cookie('storage.test'), cookie('blocked.test'), cookie('fresh.test')], ['https://storage.test'], c => c.domain !== 'blocked.test')
    expect(result).toEqual({ imported: 1, skipped: 3, failed: 0, recoveryRequired: false, origins: ['https://fresh.test'] })
    expect([...cookies.keys()]).toEqual(['.existing.test', 'fresh.test'])
    expect(cookies.get('.existing.test')?.value).toBe('keep')
  })
  it('rolls back all attempted writes on partial failure while preserving unrelated sites', async () => {
    const { cookies, target, session } = jar([cookie('unrelated.test', 'keep')])
    const normal = target.cookies.set.getMockImplementation()!
    target.cookies.set.mockImplementation(async details => { await normal(details); if (details.domain === '.second.test' && details.expirationDate !== 1) throw new Error('private value must not escape') })
    const result = await writeImportedCookies(session, [cookie('.first.test'), cookie('.second.test')], [], () => true)
    expect(result).toEqual({ imported: 0, skipped: 0, failed: 2, recoveryRequired: false, origins: [] })
    expect([...cookies.keys()]).toEqual(['unrelated.test'])
  })
  it('verifies attributes, detects a silently dropped write and reports failed recovery', async () => {
    const { target, session } = jar()
    target.cookies.set.mockResolvedValue(undefined)
    expect(await writeImportedCookies(session, [cookie('missing.test')], [], () => true)).toMatchObject({ imported: 0, failed: 1 })
    const normal = jar(); normal.target.cookies.flushStore.mockRejectedValue(new Error('disk failure'))
    expect(await writeImportedCookies(normal.session, [cookie('disk.test')], [], () => true)).toMatchObject({ failed: 1, recoveryRequired: true })
  })
})
