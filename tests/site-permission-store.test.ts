import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeSitePermissionOrigin, SitePermissionStore } from '../src/main/site-permission-store.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function createStore(): Promise<{ path: string; store: SitePermissionStore }> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-permissions-test-'))
  temporaryDirectories.push(directory)
  const path = join(directory, 'profile', 'site-permissions.json')
  return { path, store: new SitePermissionStore(path) }
}

describe('SitePermissionStore', () => {
  it('lets shutdown wait for an already-queued permission write', async () => {
    const { path, store } = await createStore()
    const remembering = store.set('https://shutdown-permission.example', 'notifications', 'allow')

    await store.flush()

    await expect(remembering).resolves.toMatchObject({ decision: 'allow' })
    await expect(new SitePermissionStore(path).load()).resolves.toEqual([
      expect.objectContaining({ origin: 'https://shutdown-permission.example', permission: 'notifications' })
    ])
  })

  it('ignores a site-permissions file containing JSON null', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(path, 'null\n', 'utf8')

    await expect(store.load()).resolves.toEqual([])
  })

  it('persists exact per-origin permission decisions', async () => {
    const { path, store } = await createStore()
    await store.load()
    await store.set('https://example.com/some/page', 'geolocation', 'allow')
    await store.set('https://example.com', 'notifications', 'deny')

    expect(store.get('https://example.com/another/page', 'geolocation')).toBe('allow')
    expect(store.get('https://example.com', 'notifications')).toBe('deny')
    expect(store.get('https://sub.example.com', 'geolocation')).toBeUndefined()
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      permissions: [
        { origin: 'https://example.com', permission: 'geolocation', decision: 'allow' },
        { origin: 'https://example.com', permission: 'notifications', decision: 'deny' }
      ]
    })

    const restored = new SitePermissionStore(path)
    expect(await restored.load()).toEqual(store.list())
  })

  it('changes, removes, and clears remembered decisions', async () => {
    const { store } = await createStore()
    await store.load()
    await store.set('https://example.com', 'geolocation', 'allow')
    await store.set('https://example.com', 'geolocation', 'deny')
    expect(store.get('https://example.com', 'geolocation')).toBe('deny')
    expect(await store.remove('https://example.com', 'geolocation')).toBe(true)
    expect(store.list()).toEqual([])

    await store.set('https://one.example', 'notifications', 'allow')
    await store.set('https://two.example', 'media', 'deny')
    await store.clear()
    expect(store.list()).toEqual([])
  })

  it('ignores malformed persisted entries and rejects non-website origins', async () => {
    const { path, store } = await createStore()
    await mkdir(join(path, '..'), { recursive: true })
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        permissions: [
          { origin: 'https://safe.example', permission: 'geolocation', decision: 'allow' },
          { origin: 'file:///tmp/page.html', permission: 'geolocation', decision: 'allow' },
          { origin: 'https://safe.example', permission: '../bad', decision: 'deny' }
        ]
      }),
      'utf8'
    )
    expect(await store.load()).toEqual([
      { origin: 'https://safe.example', permission: 'geolocation', decision: 'allow' }
    ])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 1,
      permissions: [
        { origin: 'https://safe.example', permission: 'geolocation', decision: 'allow' }
      ]
    })
    await expect(store.set('hronaut://home', 'geolocation', 'allow')).rejects.toThrow('HTTP or HTTPS origin')
    expect(normalizeSitePermissionOrigin('https://EXAMPLE.com:443/path')).toBe('https://example.com')
    expect(normalizeSitePermissionOrigin('not a URL')).toBeNull()
  })

  it('keeps permission decisions unchanged when mutations cannot be persisted', async () => {
    const { path, store } = await createStore()
    await store.set('https://example.com', 'geolocation', 'allow')
    const before = store.list()
    const profileDirectory = dirname(path)
    const backupDirectory = `${profileDirectory}-backup`
    await rename(profileDirectory, backupDirectory)
    await writeFile(profileDirectory, 'blocks permission directory creation', 'utf8')

    await expect(store.set('https://example.com', 'geolocation', 'deny')).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.remove('https://example.com', 'geolocation')).rejects.toThrow()
    expect(store.list()).toEqual(before)
    await expect(store.clear()).rejects.toThrow()
    expect(store.list()).toEqual(before)

    await rm(profileDirectory, { force: true })
    await rename(backupDirectory, profileDirectory)
    expect(await new SitePermissionStore(path).load()).toEqual(before)
  })
})
