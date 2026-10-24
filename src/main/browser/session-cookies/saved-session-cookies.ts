import { lstat, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { safeStorage, type Cookie, type CookiesSetDetails, type Session } from 'electron'
import { writeTextFileAtomically } from '../../atomic-file.js'

/** The file in a workspace's own browser storage that keeps its session cookies for the next start. */
const SESSION_COOKIES_FILE = 'Hronaut Session Cookies.json'
const SESSION_COOKIES_VERSION = 1
/** As Chrome keeps at most 3300 cookies in all. */
const MAX_SAVED_SESSION_COOKIES = 3300
/** As Chrome takes at most 4096 bytes for a cookie's name and value together. */
const MAX_COOKIE_CHARS = 4096
const MAX_SESSION_COOKIES_FILE_BYTES = 64 * 1024 * 1024
/** How long a change to the session cookies waits for the next before they are saved. */
const SAVE_DELAY_MS = 1_000

/** A session cookie as the file keeps it, without an expiry, as it has none. */
interface SavedSessionCookie {
  name: string
  value: string
  domain: string
  hostOnly: boolean
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: Cookie['sameSite']
}

interface WatchedSession {
  restored: Promise<void>
  saveTimer?: NodeJS.Timeout
  saveQueue: Promise<void>
  /** The cookies the file holds, as last written. */
  written?: string
  forgotten: boolean
}

const watched = new WeakMap<Session, WatchedSession>()

/**
 * Whether the system's secret storage encrypts the saved session cookies, as it does saved passwords: not Linux's
 * plain-text fallback. Without it they are saved as the workspace keeps its other cookies, readable only by the person.
 */
async function encryptionAvailable(): Promise<boolean> {
  try {
    return await safeStorage.isAsyncEncryptionAvailable()
      && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text')
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Where a session keeps its saved session cookies, or undefined for a session that keeps nothing on the disk. */
function savedCookiesPath(browserSession: Session | undefined): string | undefined {
  return browserSession?.storagePath ? join(browserSession.storagePath, SESSION_COOKIES_FILE) : undefined
}

function cookieIdentity(cookie: { domain?: string; path?: string; name: string }): string {
  return `${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.name}`
}

/**
 * Whether the file can keep a cookie: a session cookie with a domain, of a size Chrome takes, and not partitioned, as
 * Electron cannot set a partitioned cookie again.
 */
function savableSessionCookie(cookie: Cookie): boolean {
  const partitionKey = (cookie as Cookie & { partitionKey?: unknown }).partitionKey
  return cookie.session === true
    && typeof cookie.domain === 'string' && cookie.domain.replace(/^\./, '') !== ''
    && cookie.name.length + cookie.value.length <= MAX_COOKIE_CHARS
    && (partitionKey === undefined || partitionKey === null || partitionKey === '')
}

function savedCookie(cookie: Cookie): SavedSessionCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain!,
    hostOnly: cookie.hostOnly === true,
    path: cookie.path || '/',
    secure: cookie.secure === true,
    httpOnly: cookie.httpOnly === true,
    sameSite: cookie.sameSite
  }
}

function parsedCookie(value: unknown): SavedSessionCookie | undefined {
  if (!isRecord(value)) return undefined
  const { name, value: cookieValue, domain, hostOnly, path, secure, httpOnly, sameSite } = value
  if (typeof name !== 'string' || typeof cookieValue !== 'string' || typeof domain !== 'string' || domain.replace(/^\./, '') === ''
    || typeof hostOnly !== 'boolean' || typeof path !== 'string' || !path.startsWith('/') || typeof secure !== 'boolean'
    || typeof httpOnly !== 'boolean' || name.length + cookieValue.length > MAX_COOKIE_CHARS
    || (sameSite !== 'unspecified' && sameSite !== 'no_restriction' && sameSite !== 'lax' && sameSite !== 'strict')) return undefined
  return { name, value: cookieValue, domain, hostOnly, path, secure, httpOnly, sameSite }
}

/** What setting a saved session cookie again takes: its address, and no expiry, so it stays a session cookie. */
function cookieDetails(cookie: SavedSessionCookie): CookiesSetDetails {
  return {
    url: `${cookie.secure ? 'https' : 'http'}://${cookie.domain.replace(/^\./, '')}${cookie.path}`,
    name: cookie.name,
    value: cookie.value,
    ...(cookie.hostOnly ? {} : { domain: cookie.domain }),
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite
  }
}

async function readSavedCookies(path: string): Promise<SavedSessionCookie[]> {
  let contents: string
  try {
    const entry = await lstat(path)
    if (!entry.isFile() || entry.size > MAX_SESSION_COOKIES_FILE_BYTES) throw new Error('Not saved session cookies')
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const data = JSON.parse(contents) as unknown
  if (!isRecord(data) || data.version !== SESSION_COOKIES_VERSION) throw new Error('Not saved session cookies')
  let cookies: unknown = data.cookies
  if (typeof data.encrypted === 'string') {
    if (!await encryptionAvailable()) throw new Error('The saved session cookies are encrypted')
    cookies = JSON.parse((await safeStorage.decryptStringAsync(Buffer.from(data.encrypted, 'base64'))).result) as unknown
  }
  if (!Array.isArray(cookies)) throw new Error('Not saved session cookies')
  return cookies.slice(0, MAX_SAVED_SESSION_COOKIES).flatMap((cookie) => parsedCookie(cookie) ?? [])
}

/**
 * Puts a workspace's saved session cookies back, as Chrome does when it continues where you left off: each one the
 * session does not hold already, as a page may have set it again meanwhile. A file that cannot be read only loses them.
 */
async function restoreSavedCookies(browserSession: Session, path: string): Promise<void> {
  let saved: SavedSessionCookie[]
  try {
    saved = await readSavedCookies(path)
  } catch {
    console.warn('[browser] A workspace\'s saved session cookies could not be read; its sites ask to sign in again.')
    return
  }
  if (!saved.length) return
  const present = new Set((await browserSession.cookies.get({})).map(cookieIdentity))
  const results = await Promise.allSettled(saved.filter((cookie) => !present.has(cookieIdentity(cookie)))
    .map((cookie) => browserSession.cookies.set(cookieDetails(cookie))))
  const failed = results.filter((result) => result.status === 'rejected').length
  if (failed) console.warn(`[browser] ${failed} saved session cookie${failed === 1 ? '' : 's'} could not be set again.`)
}

/** Writes the session's session cookies to its file, or removes the file when it holds none. */
async function writeSessionCookies(browserSession: Session, state: WatchedSession): Promise<void> {
  const path = savedCookiesPath(browserSession)
  if (!path || state.forgotten) return
  const cookies = (await browserSession.cookies.get({})).filter(savableSessionCookie).slice(0, MAX_SAVED_SESSION_COOKIES).map(savedCookie)
  const contents = JSON.stringify(cookies)
  if (state.forgotten || contents === state.written) return
  if (!cookies.length) {
    await rm(path, { force: true })
    state.written = contents
    return
  }
  const data = await encryptionAvailable()
    ? { version: SESSION_COOKIES_VERSION, encrypted: (await safeStorage.encryptStringAsync(contents)).toString('base64') }
    : { version: SESSION_COOKIES_VERSION, cookies }
  if (state.forgotten) return
  await writeTextFileAtomically(path, `${JSON.stringify(data)}\n`, 0o600)
  state.written = contents
}

function queueSave(browserSession: Session, state: WatchedSession): Promise<void> {
  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = undefined
  const operation = state.saveQueue.then(() => state.restored).then(() => writeSessionCookies(browserSession, state))
  state.saveQueue = operation.catch(() => undefined)
  return operation
}

function watchedSession(browserSession: Session, path: string): WatchedSession {
  const existing = watched.get(browserSession)
  if (existing) return existing
  const state: WatchedSession = { restored: Promise.resolve(), saveQueue: Promise.resolve(), forgotten: false }
  watched.set(browserSession, state)
  state.restored = restoreSavedCookies(browserSession, path).catch(() => {
    console.warn('[browser] A workspace\'s saved session cookies could not be set again; its sites ask to sign in again.')
  })
  browserSession.cookies.on('changed', (_event, cookie) => {
    if (state.forgotten || cookie.session !== true) return
    if (state.saveTimer) clearTimeout(state.saveTimer)
    state.saveTimer = setTimeout(() => {
      state.saveTimer = undefined
      void queueSave(browserSession, state).catch((error: unknown) => console.error('[browser] Failed to save session cookies:', error))
    }, SAVE_DELAY_MS)
    state.saveTimer.unref()
  })
  return state
}

/**
 * Keeps a workspace's session cookies across restarts, as Chrome does when it continues where you left off: the saved
 * ones are put back the first time, and each change is saved a moment later. It resolves once they are back, which a
 * workspace's pages wait for before they load.
 */
export function keepSessionCookies(browserSession: Session | undefined): Promise<void> {
  const path = savedCookiesPath(browserSession)
  return path ? watchedSession(browserSession!, path).restored : Promise.resolve()
}

/** Saves the session cookies of a workspace whose cookies are kept, as Hronaut quits; others keep what they saved. */
export function saveSessionCookies(browserSession: Session): Promise<void> {
  const state = watched.get(browserSession)
  return state && !state.forgotten ? queueSave(browserSession, state) : Promise.resolve()
}

/** Forgets a deleted workspace's saved session cookies, without putting them back, and saves none of it again. */
export async function forgetSessionCookies(browserSession: Session): Promise<void> {
  const state = watched.get(browserSession)
  if (state) {
    state.forgotten = true
    if (state.saveTimer) clearTimeout(state.saveTimer)
    state.saveTimer = undefined
    await state.saveQueue
  } else {
    watched.set(browserSession, { restored: Promise.resolve(), saveQueue: Promise.resolve(), forgotten: true })
  }
  const path = savedCookiesPath(browserSession)
  if (path) await rm(path, { force: true })
}
