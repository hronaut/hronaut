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
/** How long after a change to the session cookies they are saved, however often they change meanwhile. */
const SAVE_DELAY_MS = 1_000
/**
 * How long a page, a quit or a workspace's deletion waits for the session cookies to be read or saved, as the system's
 * secret storage can wait for the person to unlock it.
 */
const SESSION_COOKIES_WAIT_MS = 3_000

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
  /** Whether the saved cookies are being set again, which the tab manager does not publish cookie by cookie. */
  restoring: boolean
  saveTimer?: NodeJS.Timeout
  saveQueue: Promise<void>
  /** The cookies the file holds, as last written. */
  written?: string
  /** Whether the workspace was deleted, which saves nothing until it is kept again. */
  forgotten: boolean
}

const watched = new WeakMap<Session, WatchedSession>()

/**
 * Whether the system's secret storage encrypts the saved session cookies, as it does saved passwords: not Linux's
 * plain-text fallback, nor a Linux backend it cannot name. Without it they are saved as the workspace keeps its other
 * cookies, readable only by the person.
 */
async function encryptionAvailable(): Promise<boolean> {
  try {
    if (!await safeStorage.isAsyncEncryptionAvailable()) return false
    if (process.platform !== 'linux') return true
    const backend = safeStorage.getSelectedStorageBackend()
    return backend !== 'basic_text' && backend !== 'unknown'
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Settles once the operation does or the wait passes, whichever comes first, without its failure. */
function settledWithinWait(operation: Promise<void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, SESSION_COOKIES_WAIT_MS)
    timer.unref()
    void operation.catch(() => undefined).then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/** Where a session keeps its saved session cookies, or undefined for a session that keeps nothing on the disk. */
function savedCookiesPath(browserSession: Session | undefined): string | undefined {
  return browserSession?.storagePath ? join(browserSession.storagePath, SESSION_COOKIES_FILE) : undefined
}

function cookieIdentity(cookie: { domain?: string; path?: string; name: string }): string {
  return `${cookie.domain ?? ''}\u0000${cookie.path ?? '/'}\u0000${cookie.name}`
}

/**
 * The session cookies the file can keep: those with a domain, of a size Chrome takes, that only their own site can use.
 * Electron lists a partitioned cookie, which a site embedded in another site keeps for that site only, as any other and
 * cannot set it again with its partition, so a cookie sites can use while embedded in other sites (SameSite=None),
 * which a partitioned one set there is, and a cookie listed twice, as with a partitioned copy, are not kept.
 */
function savableSessionCookies(cookies: readonly Cookie[]): Cookie[] {
  const listed = new Map<string, number>()
  for (const cookie of cookies) listed.set(cookieIdentity(cookie), (listed.get(cookieIdentity(cookie)) ?? 0) + 1)
  return cookies.filter((cookie) => cookie.session === true
    && cookie.sameSite !== 'no_restriction'
    && typeof cookie.domain === 'string' && cookie.domain.replace(/^\./, '') !== ''
    && cookie.name.length + cookie.value.length <= MAX_COOKIE_CHARS
    && listed.get(cookieIdentity(cookie)) === 1)
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
    || (sameSite !== 'unspecified' && sameSite !== 'lax' && sameSite !== 'strict')) return undefined
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
 * session does not hold already, as a page may have set it again meanwhile, until the workspace is deleted. A file that
 * cannot be read, as one the system's secret storage cannot open in this run, only loses them: the next save replaces
 * it, so cookies taken away since never come back from it.
 */
async function restoreSavedCookies(browserSession: Session, path: string, state: WatchedSession): Promise<void> {
  let saved: SavedSessionCookie[]
  try {
    saved = await readSavedCookies(path)
  } catch {
    console.warn('[browser] A workspace\'s saved session cookies could not be read; its sites ask to sign in again.')
    return
  }
  if (!saved.length || state.forgotten) return
  const present = new Set((await browserSession.cookies.get({})).map(cookieIdentity))
  state.restoring = true
  let failed = 0
  try {
    for (const cookie of saved) {
      if (state.forgotten) return
      if (present.has(cookieIdentity(cookie))) continue
      await browserSession.cookies.set(cookieDetails(cookie)).catch(() => { failed += 1 })
    }
  } finally {
    state.restoring = false
  }
  if (failed) console.warn(`[browser] ${failed} saved session cookie${failed === 1 ? '' : 's'} could not be set again.`)
}

/**
 * Writes the session's session cookies to its file, or removes the file when it holds none. A write that fails removes
 * the file, so cookies taken away since, as by signing out, do not come back from it.
 */
async function writeSessionCookies(browserSession: Session, state: WatchedSession): Promise<void> {
  const path = savedCookiesPath(browserSession)
  if (!path || state.forgotten) return
  const cookies = savableSessionCookies(await browserSession.cookies.get({})).slice(0, MAX_SAVED_SESSION_COOKIES).map(savedCookie)
  const contents = JSON.stringify(cookies)
  if (state.forgotten || contents === state.written) return
  try {
    if (!cookies.length) {
      await rm(path, { force: true })
    } else {
      const data = await encryptionAvailable()
        ? { version: SESSION_COOKIES_VERSION, encrypted: (await safeStorage.encryptStringAsync(contents)).toString('base64') }
        : { version: SESSION_COOKIES_VERSION, cookies }
      if (state.forgotten) return
      await writeTextFileAtomically(path, `${JSON.stringify(data)}\n`, 0o600)
    }
    state.written = contents
  } catch (error) {
    state.written = undefined
    await rm(path, { force: true }).catch(() => undefined)
    throw error
  }
}

function queueSave(browserSession: Session, state: WatchedSession): Promise<void> {
  if (state.saveTimer) clearTimeout(state.saveTimer)
  state.saveTimer = undefined
  const operation = state.saveQueue.then(() => state.restored).then(() => writeSessionCookies(browserSession, state))
  state.saveQueue = operation.catch(() => {
    console.warn('[browser] A workspace\'s session cookies could not be saved; its sites may ask to sign in again after a restart.')
  })
  return state.saveQueue
}

function watchedSession(browserSession: Session, path: string): WatchedSession {
  const existing = watched.get(browserSession)
  if (existing) return existing
  const state: WatchedSession = { restored: Promise.resolve(), restoring: false, saveQueue: Promise.resolve(), forgotten: false }
  watched.set(browserSession, state)
  state.restored = restoreSavedCookies(browserSession, path, state).catch(() => {
    console.warn('[browser] A workspace\'s saved session cookies could not be set again; its sites ask to sign in again.')
  })
  browserSession.cookies.on('changed', (_event, cookie) => {
    if (state.forgotten || state.saveTimer || cookie.session !== true) return
    state.saveTimer = setTimeout(() => {
      state.saveTimer = undefined
      void queueSave(browserSession, state)
    }, SAVE_DELAY_MS)
    state.saveTimer.unref()
  })
  return state
}

/**
 * Keeps a workspace's session cookies across restarts, as Chrome does when it continues where you left off: the saved
 * ones are put back the first time, and each change is saved a moment later. It resolves once they are back, which a
 * workspace's pages wait for before they load, or once the wait for them passes. A deleted workspace kept again, as
 * when its deletion is undone, has its session cookies saved again.
 */
export function keepSessionCookies(browserSession: Session | undefined): Promise<void> {
  const path = savedCookiesPath(browserSession)
  if (!path) return Promise.resolve()
  const state = watchedSession(browserSession!, path)
  state.forgotten = false
  return settledWithinWait(state.restored)
}

/** Whether the session's saved session cookies are being set again, cookie by cookie. */
export function restoringSessionCookies(browserSession: Session): boolean {
  return watched.get(browserSession)?.restoring === true
}

/**
 * Saves the session cookies of a workspace whose cookies are kept at once, as Hronaut quits or stores a change to its
 * data; others keep what they saved. It never fails, and waits at most a few seconds.
 */
export function saveSessionCookies(browserSession: Session): Promise<void> {
  const state = watched.get(browserSession)
  return state && !state.forgotten ? settledWithinWait(queueSave(browserSession, state)) : Promise.resolve()
}

/**
 * Forgets a deleted workspace's saved session cookies: the ones not back yet are not put back, and none is saved
 * again until the workspace is kept again.
 */
export async function forgetSessionCookies(browserSession: Session): Promise<void> {
  const state = watched.get(browserSession)
  if (state) {
    state.forgotten = true
    if (state.saveTimer) clearTimeout(state.saveTimer)
    state.saveTimer = undefined
    await settledWithinWait(state.saveQueue)
  }
  const path = savedCookiesPath(browserSession)
  if (path) await rm(path, { force: true })
}
