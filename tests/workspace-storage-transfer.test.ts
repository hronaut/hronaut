import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Cookie, CookiesSetDetails } from 'electron'

type StorageScript = (script: string, entries: Map<string, string>) => unknown
type DebuggerListener = (event: object, method: string, params: { requestId: string }) => void
interface MockContents {
  debugger: { attach(): void; on(name: string, callback: DebuggerListener): void; sendCommand(method: string): Promise<void> }
  loadURL(url: string): Promise<void>
  executeJavaScript(script: string): Promise<unknown>
  isDestroyed(): boolean
  close(): void
}
const state = vi.hoisted(() => ({ profiles: new Map<string, ReturnType<typeof profile>>(), run: null as StorageScript | null }))
vi.mock('electron', () => ({
  session: { fromPartition: (partition: string) => state.profiles.get(partition) },
  WebContentsView: class {
    webContents: MockContents
    constructor({ webPreferences }: { webPreferences: { partition: string } }) {
      const profile = state.profiles.get(webPreferences.partition)!
      let origin = ''
      let initialized = false
      let listener: DebuggerListener
      this.webContents = {
        debugger: { attach() {}, on(_name: string, callback: DebuggerListener) { listener = callback }, async sendCommand(method: string) {
          if (method === 'Network.setBypassServiceWorker' && !initialized) throw new Error('Network command requires an initialized renderer')
        } },
        async loadURL(url: string) { initialized = true; origin = new URL(url).origin; listener({}, 'Fetch.requestPaused', { requestId: 'request' }) },
        async executeJavaScript(script: string) {
          let entries = profile.storage.get(origin)
          if (!entries) { entries = new Map(); profile.storage.set(origin, entries) }
          return state.run!(script, entries)
        },
        isDestroyed: () => false,
        close() {}
      }
    }
  }
}))
import { transferWorkspaceStorage } from '../src/main/browser/workspace-storage.js'

const origin = 'https://example.test'
function identity(cookie: Pick<Cookie, 'domain' | 'path' | 'name'>) { return `${cookie.domain}|${cookie.path}|${cookie.name}` }
function cookie(value = 'source', path = '/', domain = 'example.test'): Cookie {
  return { name: 'session', value, domain, path, hostOnly: !domain.startsWith('.'), secure: true, httpOnly: true, session: true, sameSite: 'lax' }
}
function profile(cookies: Cookie[] = []) {
  const jar = new Map(cookies.map(entry => [identity(entry), entry]))
  const storage = new Map<string, Map<string, string>>()
  return {
    jar, storage,
    cookies: {
      get: vi.fn(async () => [...jar.values()].map(entry => ({ ...entry }))),
      set: vi.fn(async (details: CookiesSetDetails) => {
        const entry = { ...details, domain: details.domain ?? new URL(details.url).hostname, path: details.path ?? '/', hostOnly: !details.domain, session: details.expirationDate === undefined, secure: details.secure ?? false, httpOnly: details.httpOnly ?? false, sameSite: details.sameSite ?? 'unspecified' } as Cookie
        if (details.expirationDate !== undefined && details.expirationDate < Date.now() / 1000) jar.delete(identity(entry))
        else jar.set(identity(entry), entry)
      }),
      remove: vi.fn(async (_url: string, name: string) => { for (const [key, entry] of jar) if (entry.name === name) jar.delete(key) }),
      flushStore: vi.fn(async () => {})
    },
    flushStorageData: vi.fn(async () => {})
  }
}
let source: ReturnType<typeof profile>
let target: ReturnType<typeof profile>
const options = { sourcePartition: 'source', targetPartition: 'target', origins: [origin], copyAllCookies: false, copyLocalStorage: true, allowCookieCleanup: true, allowLocalStorageCleanup: true }
beforeEach(() => {
  source = profile([cookie()]); target = profile()
  state.profiles = new Map([['source', source], ['target', target]])
  state.run = (script: string, entries: Map<string, string>) => runInNewContext(script, { localStorage: {
    get length() { return entries.size }, key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key)
  } })
})

describe('workspace data transfer', () => {
  it('verifies a destination before removing source data on Move and preserves unrelated keys', async () => {
    source.storage.set(origin, new Map([['shared', 'source']]))
    target.storage.set(origin, new Map([['shared', 'old'], ['unrelated', 'keep']]))
    const result = await transferWorkspaceStorage({ ...options, mode: 'move' })
    expect(source.jar.size).toBe(0)
    expect(source.storage.get(origin)?.size).toBe(0)
    expect(target.storage.get(origin)).toEqual(new Map([['shared', 'source'], ['unrelated', 'keep']]))
    expect(result).toMatchObject({ cleanupStatus: 'complete', removedCookieCount: 1, removedLocalStorageItemCount: 1 })
    expect(source.cookies.remove).not.toHaveBeenCalled()
  })
  it('rejects silently dropped cookie writes before touching the source', async () => {
    target.cookies.set.mockImplementation(async () => {})
    await expect(transferWorkspaceStorage({ ...options, mode: 'move' })).rejects.toThrow(/verif/i)
    expect([...source.jar.values()]).toEqual([cookie()])
  })
  it('rejects a localStorage read-back mismatch before touching either source category', async () => {
    source.storage.set(origin, new Map([['shared', 'source']]))
    target.flushStorageData.mockImplementation(async () => { target.storage.get(origin)?.set('shared', 'different') })
    await expect(transferWorkspaceStorage({ ...options, mode: 'move' })).rejects.toThrow(/verif/i)
    expect(source.storage.get(origin)?.get('shared')).toBe('source')
    expect(source.jar.size).toBe(1)
  })
  it('retains source entries changed during copy and reports incomplete cleanup', async () => {
    source.storage.set(origin, new Map([['shared', 'source']]))
    target.flushStorageData.mockImplementation(async () => {
      source.jar.set(identity(cookie()), cookie('new'))
      source.storage.get(origin)?.set('shared', 'new')
      source.storage.get(origin)?.set('created', 'new')
    })
    const result = await transferWorkspaceStorage({ ...options, mode: 'move' })
    expect([...source.jar.values()][0]?.value).toBe('new')
    expect(source.storage.get(origin)).toEqual(new Map([['shared', 'new'], ['created', 'new']]))
    expect(result).toMatchObject({ cleanupStatus: 'incomplete', retainedCookieCount: 1, retainedLocalStorageItemCount: 1 })
  })
  it('expires exact cookie identities without URL/name deletion of siblings', async () => {
    source.jar.set(identity(cookie('other', '/private', 'other.test')), cookie('other', '/private', 'other.test'))
    target.jar.set(identity(cookie('keep', '/private')), cookie('keep', '/private'))
    await transferWorkspaceStorage({ ...options, mode: 'move' })
    expect([...source.jar.values()]).toEqual([cookie('other', '/private', 'other.test')])
    expect(target.jar.get(identity(cookie('keep', '/private')))?.value).toBe('keep')
  })
  it('retains the verified copy and reports source cleanup errors', async () => {
    source.cookies.set.mockRejectedValue(new Error('delete failed'))
    const result = await transferWorkspaceStorage({ ...options, mode: 'move' })
    expect(result).toMatchObject({ cleanupStatus: 'incomplete', retainedCookieCount: 1 })
    expect(target.jar.get(identity(cookie()))?.value).toBe('source')
  })
  it('retains cookies unless caller guarantees writer exclusion', async () => {
    const result = await transferWorkspaceStorage({ ...options, mode: 'move', allowCookieCleanup: false })
    expect(result).toMatchObject({ cleanupStatus: 'incomplete', retainedCookieCount: 1 })
    expect(source.jar.size).toBe(1)
    expect(target.jar.size).toBe(1)
  })
  it('retains localStorage unless caller excludes document writers', async () => {
    source.storage.set(origin, new Map([['shared', 'source']]))
    const result = await transferWorkspaceStorage({ ...options, mode: 'move', allowLocalStorageCleanup: false })
    expect(result).toMatchObject({ cleanupStatus: 'incomplete', retainedLocalStorageItemCount: 1 })
    expect(source.storage.get(origin)?.get('shared')).toBe('source')
    expect(target.storage.get(origin)?.get('shared')).toBe('source')
  })
  it('reports incomplete cleanup when source flush fails without rolling back destination', async () => {
    source.flushStorageData.mockRejectedValue(new Error('flush failed'))
    const result = await transferWorkspaceStorage({ ...options, mode: 'move' })
    expect(result.cleanupStatus).toBe('incomplete')
    expect(target.jar.get(identity(cookie()))?.value).toBe('source')
  })
  it('rolls back a failed copy without deleting same-name destination sibling paths', async () => {
    target.jar.set(identity(cookie('keep', '/private')), cookie('keep', '/private'))
    target.flushStorageData.mockRejectedValueOnce(new Error('flush failed'))
    await expect(transferWorkspaceStorage(options)).rejects.toThrow('Browser profile storage could not be fully flushed')
    expect([...target.jar.values()]).toEqual([cookie('keep', '/private')])
  })
  it('rejects a destination flush failure before source cleanup', async () => {
    target.flushStorageData.mockRejectedValueOnce(new Error('flush failed'))
    await expect(transferWorkspaceStorage({ ...options, mode: 'move' })).rejects.toThrow('Browser profile storage could not be fully flushed')
    expect(source.jar.size).toBe(1)
    expect(source.cookies.set).not.toHaveBeenCalled()
  })
  it('defaults to Copy and leaves source entries intact', async () => {
    const result = await transferWorkspaceStorage(options)
    expect(source.jar.size).toBe(1)
    expect(target.jar.size).toBe(1)
    expect(result.cleanupStatus).toBeUndefined()
  })
})
