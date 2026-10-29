import { createCipheriv, createHash, pbkdf2Sync } from 'node:crypto'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ImportProfile } from '../src/main/browser-import/contracts.js'
import { decryptLinuxCookie, discoverImportProfiles, linuxChromeConfigHome, linuxConfigHome, readImportCookies } from '../src/main/browser-import/source.js'
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
  // Firefox 147 and later keep a new install's profiles in the XDG configuration folder, where import did not look, so
  // they were missing from the list.
  it.each([
    '.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox',
    '.config/mozilla/firefox', '.var/app/org.mozilla.firefox/config/mozilla/firefox'
  ])('preserves Firefox names and folder fallback in %s', async relativeRoot => {
    const home = await directory(); const root = join(home, relativeRoot)
    for (const folder of ['first', 'second', 'unnamed']) { await mkdir(join(root, folder), { recursive: true }); await writeFile(join(root, folder, 'cookies.sqlite'), 'not SQLite') }
    await writeFile(join(root, 'profiles.ini'), '[Profile0]\nName=研究 🚀\nIsRelative=1\nPath=first\n[Profile1]\nName=研究 🚀\nIsRelative=1\nPath=second\n[Profile2]\nName=  \nIsRelative=1\nPath=unnamed\n')
    const sources = await discoverImportProfiles(home)
    expect(sources.map(source => source.name)).toEqual(['研究 🚀 · first', '研究 🚀 · second', 'unnamed'])
    expect(new Set(sources.map(source => source.id)).size).toBe(3)
  })
  it('finds Firefox profiles in the configuration folder XDG_CONFIG_HOME names', async () => {
    const home = await directory(); const configHome = await directory(); const root = join(configHome, 'mozilla/firefox')
    await mkdir(join(root, 'abcd.default-release'), { recursive: true })
    await writeFile(join(root, 'abcd.default-release/cookies.sqlite'), 'not SQLite')
    await writeFile(join(root, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n')
    expect((await discoverImportProfiles(home, 'linux', configHome)).map(source => source.file)).toEqual([join(root, 'abcd.default-release/cookies.sqlite')])
    expect(await discoverImportProfiles(home, 'linux')).toEqual([])
  })
  it.each(['~/.mozilla linked to the configuration folder', 'the configuration folder linked to ~/.mozilla'])('lists a Firefox profile once when %s', async (link) => {
    const home = await directory(); const legacy = join(home, '.mozilla'); const xdg = join(home, '.config/mozilla')
    const [real, linked] = link.startsWith('~') ? [xdg, legacy] : [legacy, xdg]
    await mkdir(join(real, 'firefox/abcd.default-release'), { recursive: true })
    await writeFile(join(real, 'firefox/abcd.default-release/cookies.sqlite'), 'not SQLite')
    await writeFile(join(real, 'firefox/profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=abcd.default-release\n')
    await mkdir(join(linked, '..'), { recursive: true }); await symlink(real, linked)
    expect((await discoverImportProfiles(home)).map(source => source.name)).toEqual(['default-release · abcd.default-release'])
  })
  it.each([
    ['XDG_CONFIG_HOME', 'google-chrome', 'Google Chrome'],
    ['XDG_CONFIG_HOME', 'chromium', 'Chromium'],
    ['CHROME_CONFIG_HOME', 'google-chrome-beta', 'Google Chrome Beta']
  ])('finds Chrome profiles in the folder %s names, %s', async (variable, folder, browser) => {
    // Chrome keeps its profiles there, but discovery only looked in ~/.config, so it listed none.
    const home = await directory(); const configured = await directory(); const root = join(configured, folder)
    await mkdir(join(root, 'Default'), { recursive: true })
    await writeFile(join(root, 'Default/Cookies'), 'not SQLite')
    const environment = { [variable]: configured }
    const sources = await discoverImportProfiles(home, 'linux', linuxConfigHome(home, environment), linuxChromeConfigHome(home, environment))
    expect(sources).toEqual([expect.objectContaining({ browser, file: join(root, 'Default/Cookies') })])
    expect(await discoverImportProfiles(home, 'linux')).toEqual([])
  })
  it('lists a Chrome profile once when the configured folder is ~/.config or links to it', async () => {
    const home = await directory(); const root = join(home, '.config/google-chrome')
    await mkdir(join(root, 'Default'), { recursive: true })
    await writeFile(join(root, 'Default/Cookies'), 'not SQLite')
    const linked = join(home, 'linked-config'); await symlink(join(home, '.config'), linked)
    expect(await discoverImportProfiles(home, 'linux', join(home, '.config'), join(home, '.config'))).toHaveLength(1)
    expect(await discoverImportProfiles(home, 'linux', linked, linked)).toHaveLength(1)
  })
  it('also lists the Chrome profiles of XDG_CONFIG_HOME and ~/.config, naming the folder of each, so the pickers tell them apart', async () => {
    // A Chrome started without CHROME_CONFIG_HOME, or before XDG_CONFIG_HOME was set, left its profiles there. Each
    // folder's Default profile read "Google Chrome · Default", in the picker and in the consent dialog alike.
    const home = await directory(); const chrome = await directory(); const xdg = join(home, 'xdg-config')
    for (const folder of [chrome, xdg, join(home, '.config')]) {
      await mkdir(join(folder, 'google-chrome/Default'), { recursive: true })
      await writeFile(join(folder, 'google-chrome/Default/Cookies'), 'not SQLite')
    }
    const environment = { CHROME_CONFIG_HOME: chrome, XDG_CONFIG_HOME: xdg }
    const sources = await discoverImportProfiles(home, 'linux', linuxConfigHome(home, environment), linuxChromeConfigHome(home, environment))
    expect(sources.map(({ browser, name, file }) => ({ browser, name, file }))).toEqual([
      { browser: 'Google Chrome', name: 'Default', file: join(chrome, 'google-chrome/Default/Cookies') },
      { browser: 'Google Chrome (~/xdg-config)', name: 'Default', file: join(xdg, 'google-chrome/Default/Cookies') },
      { browser: 'Google Chrome (~/.config)', name: 'Default', file: join(home, '.config/google-chrome/Default/Cookies') }
    ])
    // A folder outside the home folder is named in full.
    const outsideHome = await discoverImportProfiles(home, 'linux', chrome, join(home, '.config'))
    expect(outsideHome.map((source) => source.browser)).toEqual(['Google Chrome', `Google Chrome (${chrome})`])
  })
  it('takes CHROME_CONFIG_HOME before XDG_CONFIG_HOME, and only an absolute path', () => {
    expect(linuxChromeConfigHome('/home/person', { CHROME_CONFIG_HOME: '/chrome', XDG_CONFIG_HOME: '/data/config' })).toBe('/chrome')
    expect(linuxChromeConfigHome('/home/person', { CHROME_CONFIG_HOME: 'chrome', XDG_CONFIG_HOME: '/data/config' })).toBe('/data/config')
    expect(linuxChromeConfigHome('/home/person', {})).toBe('/home/person/.config')
  })
  it('takes XDG_CONFIG_HOME only when it is an absolute path', () => {
    expect(linuxConfigHome('/home/person', { XDG_CONFIG_HOME: '/data/config' })).toBe('/data/config')
    expect(linuxConfigHome('/home/person', { XDG_CONFIG_HOME: 'config' })).toBe('/home/person/.config')
    expect(linuxConfigHome('/home/person', {})).toBe('/home/person/.config')
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
    const { signal } = new AbortController()
    expect(await readImportCookies(profile(file), readKey, signal)).toMatchObject({ skipped: 1, cookies: [{ value: 'keyring-cookie' }] })
    expect(readKey).toHaveBeenCalledExactlyOnceWith('chrome', { signal })
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
  it('reads a Chromium expiry with a fraction of a second as the value Electron gives back for the imported cookie', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-10-20T00:00:00Z') })
    try {
      const file = join(await directory(), 'Cookies'); const db = chromiumDatabase(file)
      const insert = db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      // Max-Age cookies expire a whole number of microseconds after the moment they were set. Electron keeps whole
      // microseconds, so an imported cookie reads back as microseconds from 1970 divided by a million.
      const expiries = [13439494988416931n, ...Array.from({ length: 50 }, (_, index) => (
        BigInt(Date.now()) * 1000n + 11_644_473_600_000_000n + 3_600_000_000n + BigInt(index) * 86_400_123_457n + 416_931n
      ))]
      expiries.forEach((expires, index) => insert.run('.example.test', `cookie-${index}`, '', encrypted('signed-in', '.example.test'), '/', 1, 1, expires, 1, 1, 1, ''))
      db.close()
      const { cookies } = await readImportCookies(profile(file))
      const byName = new Map(cookies.map(cookie => [cookie.name, cookie.expirationDate]))
      expect(byName.get('cookie-0')).toBe(1795021388.416931)
      for (const [index, expires] of expiries.entries()) {
        expect(byName.get(`cookie-${index}`)).toBe(Number(expires - 11_644_473_600_000_000n) / 1_000_000)
      }
    } finally { vi.useRealTimers() }
  })
  it.each(['chromium', 'firefox'] as const)('shortens a %s expiry past 400 days to whole seconds within them, as Chromium keeps it', async kind => {
    const now = Date.parse('2026-10-20T00:00:00.750Z')
    vi.useFakeTimers({ toFake: ['Date'], now })
    try {
      const file = join(await directory(), kind === 'chromium' ? 'Cookies' : 'cookies.sqlite')
      const longest = Math.floor(now / 1000) + 400 * 24 * 60 * 60
      if (kind === 'chromium') {
        const db = chromiumDatabase(file)
        const insert = db.prepare('INSERT INTO cookies VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
        insert.run('.example.test', 'long', '', encrypted('signed-in', '.example.test'), '/', 1, 1, (BigInt(longest) + 100n * 86_400n) * 1_000_000n + 11_644_473_600_000_000n + 250_000n, 1, 1, 1, '')
        insert.run('.example.test', 'within', '', encrypted('signed-in', '.example.test'), '/', 1, 1, (BigInt(longest) - 1n) * 1_000_000n + 11_644_473_600_000_000n, 1, 1, 1, '')
        db.close()
      } else {
        const db = new DatabaseSync(file)
        db.exec('PRAGMA user_version=16; CREATE TABLE moz_cookies(host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, originAttributes TEXT, sameSite INTEGER, isPartitionedAttributeSet INTEGER)')
        const insert = db.prepare('INSERT INTO moz_cookies VALUES(?,?,?,?,?,?,?,?,?,?)')
        insert.run('example.test', 'long', 'firefox', '/', now + 500 * 24 * 60 * 60 * 1000, 1, 1, '', 1, 0)
        insert.run('example.test', 'within', 'firefox', '/', (longest - 1) * 1000, 1, 1, '', 1, 0)
        // A malformed expiry stays invalid instead of becoming 400 days.
        insert.run('example.test', 'infinite', 'firefox', '/', Number.POSITIVE_INFINITY, 1, 1, '', 1, 0)
        db.close()
      }
      const { cookies } = await readImportCookies(profile(file, kind))
      expect(Object.fromEntries(cookies.map(cookie => [cookie.name, cookie.expirationDate]))).toEqual({ long: longest, within: longest - 1 })
    } finally { vi.useRealTimers() }
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
