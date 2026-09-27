import { createDecipheriv, createHash, pbkdf2Sync, randomUUID, timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { lstat, readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Cookie } from 'electron'
import { BrowserImportError, type CookieSnapshot, type ImportProfile } from './contracts.js'

const MAX_ROWS = 20_000
const MAX_BYTES = 128 * 1024 * 1024
const MAX_VALUES = 16 * 1024 * 1024
const UTF8 = new TextDecoder('utf-8', { fatal: true })

async function exists(file: string): Promise<boolean> {
  try { const s = await lstat(file); return s.isFile() && !s.isSymbolicLink() } catch { return false }
}
async function smallText(file: string): Promise<string> {
  const s = await lstat(file)
  if (!s.isFile() || s.isSymbolicLink() || s.size > 4 * 1024 * 1024) throw new BrowserImportError('readFailed')
  const bytes = await readFile(file)
  if (bytes.length > 4 * 1024 * 1024) throw new BrowserImportError('tooLarge')
  return UTF8.decode(bytes)
}
function label(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').slice(0, 80) || fallback : fallback
}

/** Discovery reads profile names only, never the cookie database or OS keys. */
export async function discoverImportProfiles(home = homedir(), platform = process.platform): Promise<ImportProfile[]> {
  if (platform !== 'linux') throw new BrowserImportError('unsupported')
  const profiles: ImportProfile[] = []
  const chromiumRoots = [
    ['Google Chrome', join(home, '.config/google-chrome'), 'chrome'],
    ['Google Chrome Beta', join(home, '.config/google-chrome-beta'), 'chrome'],
    ['Chromium', join(home, '.config/chromium'), 'chromium'],
    ['Chromium (Snap)', join(home, 'snap/chromium/common/chromium'), 'chromium'],
    ['Chromium (Flatpak)', join(home, '.var/app/org.chromium.Chromium/config/chromium'), 'chromium']
  ] as const
  for (const [browser, root, keyApplication] of chromiumRoots) {
    let names: Record<string, { name?: unknown }> = {}
    try { names = JSON.parse(await smallText(join(root, 'Local State')))?.profile?.info_cache ?? {} } catch { /* Directory names remain usable. */ }
    let directories: string[]
    try { directories = (await readdir(root)).filter(n => n === 'Default' || /^Profile \d+$/.test(n)).slice(0, 100) } catch { continue }
    for (const directory of directories) {
      const file = await exists(join(root, directory, 'Network/Cookies')) ? join(root, directory, 'Network/Cookies') : join(root, directory, 'Cookies')
      if (!await exists(file)) continue
      profiles.push({ id: randomUUID(), browser, name: `${label(names[directory]?.name, directory)} · ${directory}`, file, kind: 'chromium', keyApplication })
    }
  }
  for (const root of [join(home, '.mozilla/firefox'), join(home, 'snap/firefox/common/.mozilla/firefox'), join(home, '.var/app/org.mozilla.firefox/.mozilla/firefox')]) {
    let ini: string
    try { ini = await smallText(join(root, 'profiles.ini')) } catch { continue }
    for (const section of ini.split(/(?=^\[)/m).slice(0, 150)) {
      if (!/^\[Profile\d+\]/.test(section)) continue
      const values = Object.fromEntries([...section.matchAll(/^(Name|Path|IsRelative)=(.*)\r?$/gm)].map(m => [m[1], m[2]!.trim()]))
      if (!values.Path) continue
      const folder = values.IsRelative === '1' ? resolve(root, values.Path) : values.Path
      const file = join(folder, 'cookies.sqlite')
      if (!await exists(file) || profiles.some(p => p.file === file)) continue
      profiles.push({ id: randomUUID(), browser: 'Firefox', name: `${label(values.Name, 'Default')} · ${basename(folder)}`, file, kind: 'firefox', keyApplication: '' })
    }
  }
  return profiles.slice(0, 300)
}

/** Only called after native read consent. Never writes or creates a keyring entry. */
export function readLinuxBrowserKey(application: string): Promise<Buffer> {
  if (!['chrome', 'chromium'].includes(application)) throw new BrowserImportError('keyUnavailable')
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/secret-tool', ['lookup', 'application', application], { timeout: 30_000, maxBuffer: 4096, encoding: 'buffer' }, (error, stdout) => {
      try {
        if (error || !stdout.length) { reject(new BrowserImportError('keyUnavailable')); return }
        const secret = stdout.subarray(0, stdout.at(-1) === 10 ? stdout.length - 1 : stdout.length)
        resolve(pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1'))
      } finally { stdout.fill(0) }
    })
  })
}

// Chromium's Linux v10/v11 format: components/os_crypt/async/{browser,common}.
// Database v24 binds ciphertext to host_key with a SHA-256 prefix.
export function decryptLinuxCookie(encrypted: Uint8Array, host: string, version: number, key?: Buffer): string {
  const bytes = Buffer.from(encrypted)
  const tag = bytes.subarray(0, 3).toString('ascii')
  if (tag !== 'v10' && tag !== 'v11') throw new BrowserImportError('readFailed')
  if (tag === 'v11' && !key) throw new BrowserImportError('keyUnavailable')
  const derived = tag === 'v10' ? pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1') : key!
  let plain: Buffer | undefined
  try {
    const cipher = createDecipheriv('aes-128-cbc', derived, Buffer.alloc(16, 32))
    plain = Buffer.concat([cipher.update(bytes.subarray(3)), cipher.final()])
    if (version >= 24) {
      const digest = createHash('sha256').update(host).digest()
      if (plain.length < 32 || !timingSafeEqual(plain.subarray(0, 32), digest)) throw new BrowserImportError('readFailed')
    }
    return UTF8.decode(version >= 24 ? plain.subarray(32) : plain)
  } finally { plain?.fill(0); if (tag === 'v10') derived.fill(0) }
}

function validCookie(cookie: Cookie): boolean {
  const host = cookie.domain?.replace(/^\./, '') ?? ''
  if (!host || host.length > 253 || /[\s\p{Cc}\p{Cf}/\\:@?#%]/u.test(host)) return false
  try { if (new URL(`https://${host}`).hostname !== host) return false } catch { return false }
  return cookie.name.length <= 1024 && !/[\p{Cc};=]/u.test(cookie.name)
    && cookie.value.length <= 16_384 && !/[\p{Cc};]/u.test(cookie.value)
    && !!cookie.path?.startsWith('/') && cookie.path.length <= 2048 && !/[\p{Cc}?#]/u.test(cookie.path)
    && (cookie.session || (Number.isFinite(cookie.expirationDate) && cookie.expirationDate! > Date.now() / 1000))
}

function cookieMetadata(row: Record<string, unknown>, kind: ImportProfile['kind'], version: number): Cookie | null {
  const chrome = kind === 'chromium'
  if (chrome ? row.top_frame_site_key !== '' : row.originAttributes !== '' || row.isPartitionedAttributeSet === 1) return null
  if (typeof row.name !== 'string' || typeof row.value !== 'string' || typeof row.path !== 'string'
    || typeof (chrome ? row.host_key : row.host) !== 'string'
    || ![0, 1].includes(chrome ? row.is_secure as number : row.isSecure as number)
    || ![0, 1].includes(chrome ? row.is_httponly as number : row.isHttpOnly as number)) return null
  if (chrome && row.encrypted_value instanceof Uint8Array && row.encrypted_value.length && row.value !== '') return null
  const domain = String(chrome ? row.host_key : row.host)
  const expirationDate = chrome ? Number(row.expires_utc) / 1_000_000 - 11_644_473_600 : Number(row.expiry) / (version >= 16 ? 1000 : 1)
  const session = chrome ? row.is_persistent === 0 && row.has_expires === 0 : false
  const sameSiteValue = chrome ? Number(row.samesite)
    : version >= 15 ? Number(row.sameSite)
    : row.rawSameSite === 0 && row.sameSite === 1 ? 256 : Number(row.rawSameSite)
  const sameSite = chrome
    ? ({ '-1': 'unspecified', '0': 'no_restriction', '1': 'lax', '2': 'strict' } as const)[sameSiteValue as -1 | 0 | 1 | 2]
    : ({ '0': 'no_restriction', '1': 'lax', '2': 'strict', '256': 'unspecified' } as const)[sameSiteValue as 0 | 1 | 2 | 256]
  if (!sameSite) return null
  const cookie: Cookie = { name: row.name, value: '', domain, path: row.path, hostOnly: !domain.startsWith('.'), secure: (chrome ? row.is_secure : row.isSecure) === 1, httpOnly: (chrome ? row.is_httponly : row.isHttpOnly) === 1, session, sameSite, ...(!session ? { expirationDate } : {}) }
  return validCookie(cookie) && (cookie.sameSite !== 'no_restriction' || cookie.secure) ? cookie : null
}

export async function readImportCookies(profile: ImportProfile, readKey = readLinuxBrowserKey): Promise<CookieSnapshot> {
  let database: DatabaseSync | undefined
  let key: Buffer | undefined
  try {
    const info = await lstat(profile.file)
    if (!info.isFile() || info.isSymbolicLink()) throw new BrowserImportError('readFailed')
    const wal = await lstat(`${profile.file}-wal`).catch(() => null)
    if (wal && (!wal.isFile() || wal.isSymbolicLink())) throw new BrowserImportError('readFailed')
    if (info.size + (wal?.size ?? 0) > MAX_BYTES) throw new BrowserImportError('tooLarge')
    database = new DatabaseSync(profile.file, { readOnly: true, allowExtension: false, timeout: 1000 })
    // One read transaction is a consistent WAL-aware snapshot; no secret temp files.
    database.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN')
    const table = profile.kind === 'chromium' ? 'cookies' : 'moz_cookies'
    if (!database.prepare('SELECT name FROM sqlite_schema WHERE type = ? AND name = ?').get('table', table)) throw new BrowserImportError('readFailed')
    let version: number
    if (profile.kind === 'chromium') {
      version = Number(database.prepare("SELECT value FROM meta WHERE key='version'").get()?.value)
      if (!Number.isInteger(version) || version < 23 || version > 24) throw new BrowserImportError('readFailed')
    } else {
      version = Number(database.prepare('PRAGMA user_version').get()?.user_version)
      if (!Number.isInteger(version) || version < 10 || version > 17) throw new BrowserImportError('readFailed')
    }
    const byteFields = profile.kind === 'chromium'
      ? ['host_key', 'name', 'value', 'encrypted_value', 'path', 'top_frame_site_key']
      : ['host', 'name', 'value', 'path', 'originAttributes']
    const rowBytes = byteFields.map(field => `coalesce(length(${field}), 0)`).join(' + ')
    const count = database.prepare(`SELECT count(*) AS n, sum(${rowBytes}) AS bytes FROM ${table}`).get()!
    if (Number(count.n) > MAX_ROWS || Number(count.bytes) > MAX_VALUES) throw new BrowserImportError('tooLarge')
    const columns = profile.kind === 'chromium'
      ? 'host_key, name, value, encrypted_value, path, is_secure, is_httponly, CAST(expires_utc AS TEXT) AS expires_utc, is_persistent, has_expires, samesite, top_frame_site_key'
      : `host, name, value, path, expiry, isSecure, isHttpOnly, originAttributes, sameSite${version < 15 ? ', rawSameSite' : ''}${version >= 13 ? ', isPartitionedAttributeSet' : ''}`
    const rows = database.prepare(`SELECT ${columns} FROM ${table} LIMIT ${MAX_ROWS + 1}`).all()
    database.exec('ROLLBACK'); database.close(); database = undefined
    if (rows.some(r => cookieMetadata(r, profile.kind, version)
      && r.encrypted_value instanceof Uint8Array && Buffer.from(r.encrypted_value).subarray(0, 3).toString() === 'v11')) key = await readKey(profile.keyApplication)
    const cookies: Cookie[] = []
    let skipped = 0
    const identities = new Set<string>()
    for (const row of rows) {
      try {
        const cookie = cookieMetadata(row, profile.kind, version)
        if (!cookie) { skipped++; continue }
        const encrypted = row.encrypted_value
        cookie.value = profile.kind === 'chromium' && encrypted instanceof Uint8Array && encrypted.length ? decryptLinuxCookie(encrypted, cookie.domain!, version, key) : String(row.value)
        const identity = `${cookie.domain}\0${cookie.path}\0${cookie.name}`
        if (!validCookie(cookie) || identities.has(identity)) { skipped++; continue }
        identities.add(identity); cookies.push(cookie)
      } catch { skipped++ }
    }
    return { cookies, skipped }
  } catch (error) {
    throw error instanceof BrowserImportError ? error : new BrowserImportError('readFailed')
  } finally { database?.close(); key?.fill(0) }
}
