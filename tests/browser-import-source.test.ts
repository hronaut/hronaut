import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportProfile } from '../src/main/browser-import/contracts.js'
import { decryptLinuxCookie, discoverImportProfiles, readImportCookies } from '../src/main/browser-import/source.js'
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
  it.each([
    ['Google Chrome', '.config/google-chrome'],
    ['Google Chrome Beta', '.config/google-chrome-beta'],
    ['Chromium', '.config/chromium'],
    ['Chromium (Snap)', 'snap/chromium/common/chromium'],
    ['Chromium (Flatpak)', '.var/app/org.chromium.Chromium/config/chromium']
  ])('uses the displayed account name for a default-named %s profile', async (browser, relativeRoot) => {
    const home = await directory(); const root = join(home, relativeRoot!)
    await mkdir(join(root, 'Profile 10'), { recursive: true })
    await writeFile(join(root, 'Profile 10/Cookies'), 'not SQLite')
    await writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 10': { name: 'Person 10', is_using_default_name: true, gaia_given_name: 'Avery', gaia_name: 'Avery Example', user_name: 'private-account@example.test' } } } }))
    const sources = await discoverImportProfiles(home)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({ browser, name: 'Avery · Profile 10', file: join(root, 'Profile 10/Cookies') })
    expect(JSON.stringify(sources)).not.toContain('private-account@example.test')
  })
  it.each([
    [{ name: 'Research', is_using_default_name: false, gaia_given_name: 'Avery' }, 'Avery (Research)'],
    [{ name: 'Person 10', is_using_default_name: true, gaia_name: 'Avery Example' }, 'Avery Example'],
    [{ name: 'Person 10', is_using_default_name: true, enterprise_label: 'Company', gaia_given_name: 'Avery' }, 'Avery (Company)'],
    [{ name: 'avery', gaia_given_name: 'Avery' }, 'Avery'],
    [{ name: '  研究 🚀\n' }, '研究 🚀'],
    [{ name: 'x'.repeat(79) + '🚀suffix' }, 'x'.repeat(79) + '🚀']
  ])('resolves bounded named Chromium metadata %j', async (metadata, expected) => {
    const home = await directory(); const root = join(home, '.config/chromium')
    await mkdir(join(root, 'Profile 10'), { recursive: true })
    await writeFile(join(root, 'Profile 10/Cookies'), 'not SQLite')
    await writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: { 'Profile 10': metadata } } }))
    expect((await discoverImportProfiles(home))[0]?.name).toBe(`${expected} · Profile 10`)
  })
  it.each([undefined, '{invalid', 'null', '{"profile":{"info_cache":[]}}', '{"profile":{"info_cache":{"Profile 10":{"name":"  "}}}}'])('falls back to profile Preferences when Local State is unusable: %s', async metadata => {
    const home = await directory(); const root = join(home, '.config/chromium')
    await mkdir(join(root, 'Profile 10'), { recursive: true })
    await writeFile(join(root, 'Profile 10/Cookies'), 'not SQLite')
    if (metadata !== undefined) await writeFile(join(root, 'Local State'), metadata)
    await writeFile(join(root, 'Profile 10/Preferences'), JSON.stringify({ profile: { name: 'Personal' } }))
    expect((await discoverImportProfiles(home))[0]?.name).toBe('Personal · Profile 10')
  })
  it.each([undefined, '{invalid', '{"profile":{"name":123}}', '{"profile":{"name":"  "}}', 'x'.repeat(4 * 1024 * 1024 + 1)])('keeps a directory fallback when Preferences are unavailable (%#)', async preferences => {
    const home = await directory(); const root = join(home, '.config/chromium')
    await mkdir(join(root, 'Profile 10'), { recursive: true })
    await writeFile(join(root, 'Profile 10/Cookies'), 'not SQLite')
    if (preferences !== undefined) await writeFile(join(root, 'Profile 10/Preferences'), preferences)
    expect((await discoverImportProfiles(home))[0]?.name).toBe('Profile 10')
  })
  it('keeps equal display names tied to distinct source directories and opaque IDs', async () => {
    const home = await directory(); const root = join(home, '.config/chromium')
    const cache = Object.fromEntries(['Default', 'Profile 10'].map(folder => [folder, { name: 'Person', is_using_default_name: true, gaia_given_name: 'Avery' }]))
    for (const folder of Object.keys(cache)) { await mkdir(join(root, folder), { recursive: true }); await writeFile(join(root, folder, 'Cookies'), 'not SQLite') }
    await writeFile(join(root, 'Local State'), JSON.stringify({ profile: { info_cache: cache } }))
    const sources = await discoverImportProfiles(home)
    expect(sources.map(source => source.name).sort()).toEqual(['Avery · Default', 'Avery · Profile 10'])
    expect(new Set(sources.map(source => source.id)).size).toBe(2)
    expect(sources.map(source => source.file).sort()).toEqual(Object.keys(cache).map(folder => join(root, folder, 'Cookies')).sort())
  })
  it.each(['.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox'])('preserves Firefox names and folder fallback in %s', async relativeRoot => {
    const home = await directory(); const root = join(home, relativeRoot)
    for (const folder of ['first', 'second', 'unnamed']) { await mkdir(join(root, folder), { recursive: true }); await writeFile(join(root, folder, 'cookies.sqlite'), 'not SQLite') }
    await writeFile(join(root, 'profiles.ini'), '[Profile0]\nName=研究 🚀\nIsRelative=1\nPath=first\n[Profile1]\nName=研究 🚀\nIsRelative=1\nPath=second\n[Profile2]\nName=  \nIsRelative=1\nPath=unnamed\n')
    const sources = await discoverImportProfiles(home)
    expect(sources.map(source => source.name)).toEqual(['研究 🚀 · first', '研究 🚀 · second', 'unnamed'])
    expect(new Set(sources.map(source => source.id)).size).toBe(3)
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
  it('does not require a browser key for partitioned v11 cookies that cannot be imported', async () => {
    const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
    addChrome(db, 'example.test', encrypted('usable', 'example.test'))
    addChrome(db, 'embedded.test', encrypted('partition-secret', 'embedded.test', 'v11', 'fixture-key'), 'https://top.test')
    db.close()
    const readKey = vi.fn(async () => { throw new Error('keyring unavailable') })
    expect(await readImportCookies(profile(file), readKey)).toMatchObject({ skipped: 1, cookies: [{ value: 'usable' }] })
    expect(readKey).not.toHaveBeenCalled()
  })
  it('does not require a browser key for expired or invalid v11 cookies', async () => {
    const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
    addChrome(db, 'example.test', encrypted('usable', 'example.test'))
    addChrome(db, 'expired.test', encrypted('old', 'expired.test', 'v11', 'fixture-key'))
    addChrome(db, 'invalid.test', encrypted('invalid', 'invalid.test', 'v11', 'fixture-key'))
    db.prepare('UPDATE cookies SET expires_utc = 1 WHERE host_key = ?').run('expired.test')
    db.prepare('UPDATE cookies SET samesite = 99 WHERE host_key = ?').run('invalid.test')
    db.close()
    const readKey = vi.fn(async () => { throw new Error('keyring unavailable') })
    expect(await readImportCookies(profile(file), readKey)).toMatchObject({ skipped: 2, cookies: [{ value: 'usable' }] })
    expect(readKey).not.toHaveBeenCalled()
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
  it('rejects oversized cookie data even when another field is null', async () => {
    const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
    db.exec("INSERT INTO cookies(host_key, name, value, encrypted_value, path) VALUES('oversize.test', 'session', NULL, zeroblob(16777217), '/')")
    db.close()
    await expect(readImportCookies(profile(file))).rejects.toMatchObject({ code: 'tooLarge', message: 'tooLarge' })
  })
  it('includes excluded partition metadata in the cookie byte budget', async () => {
    const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
    db.exec("INSERT INTO cookies(host_key, name, value, encrypted_value, path, top_frame_site_key) VALUES('oversize.test', 'session', '', zeroblob(0), '/', zeroblob(16777217))")
    db.close()
    await expect(readImportCookies(profile(file))).rejects.toMatchObject({ code: 'tooLarge' })
  })
  describe.each(['chromium', 'firefox'] as const)('%s text byte budget', kind => {
    it.each(['multibyte', 'embedded NUL'] as const)('rejects oversized %s values before reading browser keys', async encoding => {
      const file = join(await directory(), 'Cookies')
      const db = kind === 'chromium' ? chromiumDatabase(file) : new DatabaseSync(file)
      try {
        if (kind === 'firefox') db.exec('PRAGMA user_version=16; CREATE TABLE moz_cookies(host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, originAttributes TEXT, sameSite INTEGER, isPartitionedAttributeSet INTEGER)')
        const value = encoding === 'multibyte' ? 'é'.repeat(9 * 1024 * 1024) : '\0' + 'x'.repeat(16 * 1024 * 1024)
        // Prove the fixture bypasses the old character-count budget while its
        // bytes exceed the import limit (well below the database file limit).
        const size = db.prepare('SELECT length(?) AS characters, length(CAST(? AS BLOB)) AS bytes').get(value, value)!
        expect(Number(size.characters)).toBeLessThan(16 * 1024 * 1024)
        expect(Number(size.bytes)).toBeGreaterThan(16 * 1024 * 1024)
        if (kind === 'chromium') {
          addChrome(db, 'oversize.test', Buffer.alloc(0))
          db.prepare('UPDATE cookies SET value = ?').run(value)
        } else {
          db.prepare('INSERT INTO moz_cookies VALUES(?,?,?,?,?,?,?,?,?,?)').run('oversize.test', 'session', value, '/', Date.now() + 3600000, 1, 1, '', 1, 0)
        }
      } finally { db.close() }
      const readKey = vi.fn()
      await expect(readImportCookies(profile(file, kind), readKey)).rejects.toMatchObject({ code: 'tooLarge', message: 'tooLarge' })
      expect(readKey).not.toHaveBeenCalled()
    })
  })

})
