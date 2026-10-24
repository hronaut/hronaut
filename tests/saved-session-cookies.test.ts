import { EventEmitter } from 'node:events'
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cookie, CookiesSetDetails, Session } from 'electron'

const secretStorage = vi.hoisted(() => ({ available: false, backend: 'gnome_libsecret', locked: false, refuses: false }))

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: async () => secretStorage.available,
    getSelectedStorageBackend: () => secretStorage.backend,
    encryptStringAsync: async (value: string) => {
      if (secretStorage.refuses) throw new Error('Secret storage refused')
      return Buffer.from(`sealed:${Buffer.from(value).toString('base64')}`)
    },
    // A locked keyring waits for the person to unlock it.
    decryptStringAsync: (value: Buffer) => secretStorage.locked ? new Promise(() => undefined) : Promise.resolve({
      shouldReEncrypt: false,
      result: Buffer.from(value.toString().slice('sealed:'.length), 'base64').toString()
    })
  }
}))

const { forgetSessionCookies, keepSessionCookies, restoringSessionCookies, saveSessionCookies } = await import('../src/main/browser/session-cookies/saved-session-cookies.js')

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  Object.assign(secretStorage, { available: false, backend: 'gnome_libsecret', locked: false, refuses: false })
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

const FILE = 'Hronaut Session Cookies.json'

function cookie(overrides: Partial<Cookie> = {}): Cookie {
  return {
    name: 'sid', value: 'signed-in', domain: 'app.example', hostOnly: true, path: '/', secure: true, httpOnly: true,
    session: true, sameSite: 'lax', ...overrides
  }
}

/** A workspace's browser session as Electron gives it: its cookie store, which tells of each change, and its folder. */
async function workspaceSession(cookies: Cookie[] = [], beforeSet: () => Promise<void> = async () => undefined) {
  const storagePath = await mkdtemp(join(tmpdir(), 'hronaut-session-cookies-test-'))
  temporaryDirectories.push(storagePath)
  const store = new EventEmitter()
  const set: CookiesSetDetails[] = []
  const live = [...cookies]
  const browserSession = {
    storagePath,
    cookies: Object.assign(store, {
      get: async () => live.map((candidate) => ({ ...candidate })),
      set: async (details: CookiesSetDetails) => {
        await beforeSet()
        set.push(details)
        const added = cookie({
          name: details.name!, value: details.value!, domain: details.domain ?? new URL(details.url).hostname,
          hostOnly: details.domain === undefined, path: details.path, secure: details.secure, httpOnly: details.httpOnly,
          sameSite: details.sameSite ?? 'unspecified', session: details.expirationDate === undefined,
          ...(details.expirationDate === undefined ? {} : { expirationDate: details.expirationDate })
        })
        live.push(added)
      }
    })
  } as unknown as Session
  /** A page sets or removes a cookie, which the store tells of. */
  const change = (changed: Cookie, removed = false) => {
    const index = live.findIndex((candidate) => candidate.name === changed.name && candidate.domain === changed.domain)
    if (index >= 0) live.splice(index, 1)
    if (!removed) live.push(changed)
    store.emit('changed', {}, changed, removed ? 'explicit' : 'inserted', removed)
  }
  return { browserSession, storagePath, path: join(storagePath, FILE), set, live, change }
}

async function savedFile(path: string): Promise<{ version: number; cookies?: unknown[]; encrypted?: string }> {
  return JSON.parse(await readFile(path, 'utf8'))
}

describe('session cookies across a restart', () => {
  it('saves a workspace\'s session cookies at quit and puts them back as session cookies at the next start', async () => {
    // A restart signed the person out of every site whose sign-in cookie has no expiry, which Chrome keeps when it
    // continues where you left off.
    const before = await workspaceSession([
      cookie(),
      cookie({ name: 'theme', value: 'dark', domain: '.app.example', hostOnly: false, path: '/settings', secure: false, httpOnly: false, sameSite: 'strict' }),
      cookie({ name: 'remember', value: 'long', session: false, expirationDate: 2_000_000_000 })
    ])
    await keepSessionCookies(before.browserSession)
    await saveSessionCookies(before.browserSession)
    expect((await savedFile(before.path)).cookies).toEqual([
      { name: 'sid', value: 'signed-in', domain: 'app.example', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      { name: 'theme', value: 'dark', domain: '.app.example', hostOnly: false, path: '/settings', secure: false, httpOnly: false, sameSite: 'strict' }
    ])
    if (process.platform !== 'win32') expect((await lstat(before.path)).mode & 0o777).toBe(0o600)

    const after = await workspaceSession()
    await writeFile(after.path, await readFile(before.path))
    await keepSessionCookies(after.browserSession)
    expect(after.set).toEqual([
      { url: 'https://app.example/', name: 'sid', value: 'signed-in', path: '/', secure: true, httpOnly: true, sameSite: 'lax' },
      { url: 'http://app.example/settings', name: 'theme', value: 'dark', domain: '.app.example', path: '/settings', secure: false, httpOnly: false, sameSite: 'strict' }
    ])
  })

  it('keeps no cookie that may be partitioned, which Electron lists as any other and cannot set again with its partition', async () => {
    // A chat widget's partitioned cookie, kept for the one site it was embedded in, came back for every site embedding it.
    const workspace = await workspaceSession([
      cookie({ name: 'widget', domain: 'widget.example', sameSite: 'no_restriction' }),
      cookie({ name: 'twin', value: 'first-party' }),
      cookie({ name: 'twin', value: 'partitioned' }),
      cookie({ name: 'kept' })
    ])
    await keepSessionCookies(workspace.browserSession)
    await saveSessionCookies(workspace.browserSession)
    expect((await savedFile(workspace.path)).cookies).toEqual([expect.objectContaining({ name: 'kept' })])
    // Nor does a file that names one put it back.
    const after = await workspaceSession()
    await writeFile(after.path, JSON.stringify({ version: 1, cookies: [{ name: 'widget', value: 'x', domain: 'widget.example', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction' }] }))
    await keepSessionCookies(after.browserSession)
    expect(after.set).toEqual([])
  })

  it('keeps a cookie a page set again before the saved ones are back', async () => {
    const before = await workspaceSession([cookie({ value: 'old' }), cookie({ name: 'cart', value: '3' })])
    await keepSessionCookies(before.browserSession)
    await saveSessionCookies(before.browserSession)
    const after = await workspaceSession([cookie({ value: 'new' })])
    await writeFile(after.path, await readFile(before.path))
    await keepSessionCookies(after.browserSession)
    expect(after.set.map((details) => [details.name, details.value])).toEqual([['cart', '3']])
  })

  it('saves a change to a session cookie a moment later, however often it changes, and removes the file once none is left', async () => {
    vi.useFakeTimers()
    const workspace = await workspaceSession()
    await keepSessionCookies(workspace.browserSession)
    workspace.change(cookie())
    workspace.change(cookie({ name: 'remember', session: false, expirationDate: 2_000_000_000 }))
    // A page rewriting its cookie more often than the delay does not put the save off.
    for (let tick = 0; tick < 4; tick += 1) {
      await vi.advanceTimersByTimeAsync(400)
      workspace.change(cookie({ value: `rotated-${tick}` }))
    }
    await vi.waitFor(async () => expect((await savedFile(workspace.path)).cookies).toEqual([expect.objectContaining({ value: expect.stringMatching(/^rotated-/) })]), { timeout: 5_000 })
    // Signing out removes the cookie, which a crash right after must not bring back.
    workspace.change(cookie(), true)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.waitFor(async () => expect(lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' }), { timeout: 5_000 })
  })

  it('saves at quit only the workspaces whose saved cookies are back, so an archived one keeps what it saved', async () => {
    const archived = await workspaceSession()
    await writeFile(archived.path, JSON.stringify({ version: 1, cookies: [{ name: 'sid', value: 'kept', domain: 'app.example', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax' }] }))
    await saveSessionCookies(archived.browserSession)
    expect((await savedFile(archived.path)).cookies).toHaveLength(1)
    expect(archived.set).toEqual([])
  })

  it('encrypts them with the system\'s secret storage when it has one, and not with Linux\'s plain-text fallback', async () => {
    secretStorage.available = true
    const sealed = await workspaceSession([cookie()])
    await keepSessionCookies(sealed.browserSession)
    await saveSessionCookies(sealed.browserSession)
    const saved = await readFile(sealed.path, 'utf8')
    expect(saved).not.toContain('signed-in')
    expect((await savedFile(sealed.path)).encrypted).toEqual(expect.any(String))
    const after = await workspaceSession()
    await writeFile(after.path, saved)
    await keepSessionCookies(after.browserSession)
    expect(after.set.map((details) => details.value)).toEqual(['signed-in'])

    if (process.platform === 'linux') {
      secretStorage.backend = 'basic_text'
      const plain = await workspaceSession([cookie()])
      await keepSessionCookies(plain.browserSession)
      await saveSessionCookies(plain.browserSession)
      expect((await savedFile(plain.path)).cookies).toHaveLength(1)
    }
  })

  it('puts none back from a file it cannot read, without naming a cookie', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const broken = await workspaceSession()
    await writeFile(broken.path, '{"version":1,"cookies":[')
    await keepSessionCookies(broken.browserSession)
    const sealed = await workspaceSession()
    await writeFile(sealed.path, JSON.stringify({ version: 1, encrypted: Buffer.from('sealed:e30=').toString('base64') }))
    await keepSessionCookies(sealed.browserSession)
    const odd = await workspaceSession()
    await writeFile(odd.path, JSON.stringify({ version: 1, cookies: [{ name: 'sid', value: 'x', domain: '', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax' }, 'sid=x'] }))
    await keepSessionCookies(odd.browserSession)
    expect([...broken.set, ...sealed.set, ...odd.set]).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/sid|app\.example/)
  })

  it('forgets a deleted workspace\'s saved cookies, saves none of it, and saves again once its deletion is undone', async () => {
    vi.useFakeTimers()
    const deleted = await workspaceSession([cookie()])
    await keepSessionCookies(deleted.browserSession)
    await saveSessionCookies(deleted.browserSession)
    await forgetSessionCookies(deleted.browserSession)
    await expect(lstat(deleted.path)).rejects.toMatchObject({ code: 'ENOENT' })
    deleted.change(cookie({ value: 'after' }))
    await vi.advanceTimersByTimeAsync(1_000)
    await saveSessionCookies(deleted.browserSession)
    await expect(lstat(deleted.path)).rejects.toMatchObject({ code: 'ENOENT' })
    // A deletion that fails puts the workspace back, whose sign-ins are kept again.
    await keepSessionCookies(deleted.browserSession)
    await saveSessionCookies(deleted.browserSession)
    expect((await savedFile(deleted.path)).cookies).toEqual([expect.objectContaining({ value: 'after' })])
  })

  it('stops putting saved cookies back once the workspace is deleted, and tells the tab manager while it puts them back', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let calls = 0
    const restoring: boolean[] = []
    const workspace = await workspaceSession([], async () => {
      restoring.push(restoringSessionCookies(workspace.browserSession))
      if (++calls === 1) await gate
    })
    await writeFile(workspace.path, JSON.stringify({ version: 1, cookies: ['a', 'b'].map((name) => ({ name, value: name, domain: 'app.example', hostOnly: true, path: '/', secure: true, httpOnly: true, sameSite: 'lax' })) }))
    const back = keepSessionCookies(workspace.browserSession)
    await vi.waitFor(() => expect(calls).toBe(1))
    const forgotten = forgetSessionCookies(workspace.browserSession)
    release()
    await Promise.all([back, forgotten])
    expect(workspace.set.map((details) => details.name)).toEqual(['a'])
    expect(restoring).toEqual([true])
    expect(restoringSessionCookies(workspace.browserSession)).toBe(false)
  })

  it('lets pages load once the wait passes while the system\'s secret storage waits to be unlocked', async () => {
    vi.useFakeTimers()
    secretStorage.available = true
    secretStorage.locked = true
    const locked = await workspaceSession()
    await writeFile(locked.path, JSON.stringify({ version: 1, encrypted: Buffer.from('sealed:W10=').toString('base64') }))
    let back = false
    void keepSessionCookies(locked.browserSession).then(() => { back = true })
    await vi.advanceTimersByTimeAsync(2_900)
    expect(back).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect(back).toBe(true)
  })

  it('removes the file when saving fails, so a sign-out it could not save does not come back', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    secretStorage.available = true
    const workspace = await workspaceSession([cookie()])
    await keepSessionCookies(workspace.browserSession)
    await saveSessionCookies(workspace.browserSession)
    expect((await savedFile(workspace.path)).encrypted).toEqual(expect.any(String))
    secretStorage.refuses = true
    workspace.change(cookie({ value: 'signed-out' }))
    await saveSessionCookies(workspace.browserSession)
    await expect(lstat(workspace.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls.flat().join(' ')).not.toMatch(/sid|signed|app\.example/)
  })

  it('keeps nothing for a session that keeps nothing on the disk', async () => {
    const memory = { storagePath: null, cookies: { on: vi.fn() } } as unknown as Session
    await keepSessionCookies(memory)
    await saveSessionCookies(memory)
    expect(memory.cookies.on).not.toHaveBeenCalled()
  })
})
