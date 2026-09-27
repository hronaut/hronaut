import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { decryptLinuxCookie, discoverImportProfiles, readImportCookies, type ImportProfile } from '../src/main/browser-import/source.js'
const roots: string[] = []
async function directory() { const root = await mkdtemp(join(tmpdir(), 'hronaut-import-source-')); roots.push(root); return root }
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
function encrypted(value: string, host: string, tag = 'v10', password = 'peanuts') {
  const cipher = createCipheriv('aes-128-cbc', pbkdf2Sync(password, 'saltysalt', 1, 16, 'sha1'), Buffer.alloc(16, 32))
  return Buffer.concat([Buffer.from(tag), cipher.update(Buffer.concat([createHash('sha256').update(host).digest(), Buffer.from(value)])), cipher.final()])
}
function chromiumDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec("PRAGMA journal_mode=WAL; CREATE TABLE meta(key TEXT, value TEXT); INSERT INTO meta VALUES('version','24'); CREATE TABLE cookies(host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, is_secure INTEGER, is_httponly INTEGER, expires_utc INTEGER, is_persistent INTEGER, has_expires INTEGER, samesite INTEGER, top_frame_site_key TEXT)")
  return db
}
function profile(file: string, kind: ImportProfile['kind'] = 'chromium'): ImportProfile { return { id: 'profile', name: 'Work', browser: 'Browser', kind, file, keyApplication: 'chrome' } }
function addChrome(db: DatabaseSync, host: string, value: Buffer, partition = '') {
  db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(host, 'session', '', value, '/', 1, 1, (Math.floor(Date.now() / 1000) + 3600 + 11644473600) * 1e6, 1, 1, 1, partition)
}
describe('external cookie sources', () => {
  it('discovers separate named profiles without opening cookies or reading keys', async () => {
    const home = await directory(); const root = join(home, '.config/google-chrome')
    for (const folder of ['Default', 'Profile 1']) { await mkdir(join(root, folder), { recursive: true }); await writeFile(join(root, folder, 'Cookies'), 'not SQLite') }
    await writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Work' }, 'Profile 1': { name: 'Work' } } } }))
    const sources = await discoverImportProfiles(home)
    expect(sources.map(s => s.name).sort()).toEqual(['Work · Default', 'Work · Profile 1'])
    expect(new Set(sources.map(s => s.id)).size).toBe(2)
  })
  it('reads committed WAL data, decrypts v24 host-bound cookies and skips partitions without modifying the source', async () => {
    const root = await directory(); const file = join(root, 'Cookies'); const db = chromiumDatabase(file)
    try {
      addChrome(db, '.example.test', encrypted('signed-in', '.example.test'))
      addChrome(db, 'embedded.test', encrypted('partition-secret', 'embedded.test'), 'https://top.test')
      const readKey = vi.fn()
      const result = await readImportCookies(profile(file), readKey)
      expect(result).toMatchObject({ skipped: 1, cookies: [{ domain: '.example.test', value: 'signed-in', secure: true, httpOnly: true, hostOnly: false, sameSite: 'lax', session: false }] })
      expect(readKey).not.toHaveBeenCalled()
      expect(db.prepare('SELECT count(*) AS n FROM cookies').get()?.n).toBe(2)
    } finally { db.close() }
  })
  it('uses the selected browser key for v11 and rejects ciphertext transplanted to another host', async () => {
    const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
    addChrome(db, 'example.test', encrypted('keyring-cookie', 'example.test', 'v11', 'fixture-key'))
    addChrome(db, 'wrong.test', encrypted('secret', 'original.test', 'v11', 'fixture-key')); db.close()
    const readKey = vi.fn(async () => pbkdf2Sync('fixture-key', 'saltysalt', 1, 16, 'sha1'))
    expect(await readImportCookies(profile(file), readKey)).toMatchObject({ skipped: 1, cookies: [{ value: 'keyring-cookie' }] })
    expect(readKey).toHaveBeenCalledExactlyOnceWith('chrome')
    expect(() => decryptLinuxCookie(encrypted('secret', 'original.test'), 'wrong.test', 24)).toThrow()
  })
  it('maps Firefox cookies and excludes container or partition identities', async () => {
    const file = join(await directory(), 'cookies.sqlite'); const db = new DatabaseSync(file)
    db.exec('PRAGMA user_version=16; CREATE TABLE moz_cookies(host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, originAttributes TEXT, sameSite INTEGER, isPartitionedAttributeSet INTEGER)')
    const insert = db.prepare('INSERT INTO moz_cookies VALUES(?,?,?,?,?,?,?,?,?,?)')
    insert.run('example.test', 'session', 'firefox', '/', Date.now() + 3600000, 1, 1, '', 1, 0)
    insert.run('example.test', 'container', 'secret', '/', Date.now() + 3600000, 1, 1, '^userContextId=1', 1, 0)
    insert.run('expired.test', 'old', 'secret', '/', 1, 1, 1, '', 0, 0); db.close()
    expect(await readImportCookies(profile(file, 'firefox'))).toMatchObject({ skipped: 2, cookies: [{ value: 'firefox', hostOnly: true, sameSite: 'lax' }] })
  })
  it('bounds unsupported and malformed input with errors that contain no paths or secrets', async () => {
    const root = await directory(); const file = join(root, 'private-path'); await writeFile(file, 'sensitive not a database')
    await expect(readImportCookies(profile(file))).rejects.toMatchObject({ code: 'readFailed', message: 'readFailed' })
    await expect(discoverImportProfiles(root, 'win32')).rejects.toMatchObject({ code: 'unsupported' })
  })
})
