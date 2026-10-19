import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeSitePermissionOrigin, SitePermissionStore } from '../src/main/site-permission-store.js'

const temporaryDirectories: string[] = []
const WORK = '01912345-6789-7abc-8def-0123456789ab'
const CLIENT = '01912345-678a-7abc-8def-0123456789ab'
const widget = 'https://widget.example'
const firstSite = 'https://first.example'
const secondSite = 'https://second.example'

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
      version: 2,
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
      version: 2,
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

  it('loads a version 1 file as decisions for every workspace and rewrites it only once a decision changes', async () => {
    // Decisions saved before decisions belonged to a workspace must keep working where they were made.
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const saved = `${JSON.stringify({
      version: 1,
      permissions: [
        { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: WORK, note: 'ignored' },
        { origin: firstSite, permission: 'notifications', decision: 'deny' }
      ]
    })}\n`
    await writeFile(path, saved, 'utf8')
    const legacy = [
      { origin: firstSite, permission: 'notifications', decision: 'deny' },
      { origin: widget, permission: 'geolocation', decision: 'allow' }
    ]
    expect(await store.load()).toEqual(legacy)
    expect(store.decisionFor(widget, 'geolocation', CLIENT, secondSite)).toBe('allow')
    // An older Hronaut can still read the file until a decision changes.
    expect(await readFile(path, 'utf8')).toBe(saved)

    await store.set(widget, 'geolocation', 'deny', { workspaceId: CLIENT })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      version: 2,
      permissions: [...legacy, { origin: widget, permission: 'geolocation', decision: 'deny', workspaceId: CLIENT }]
    })
    expect(await new SitePermissionStore(path).load()).toEqual(store.list())
  })

  it('looks a request up in its own workspace and page, falling back only to a decision saved before scopes', async () => {
    const { store } = await createStore()
    await store.load()
    await store.set(widget, 'geolocation', 'allow', { workspaceId: WORK, embeddedIn: `${firstSite}/room?secret=1` })
    // An embedded decision is never reused on another embedding site, for the site's own page or in another workspace.
    expect(store.decisionFor(widget, 'geolocation', WORK, firstSite)).toBe('allow')
    expect(store.decisionFor(widget, 'geolocation', WORK, secondSite)).toBeUndefined()
    expect(store.decisionFor(widget, 'geolocation', WORK)).toBeUndefined()
    expect(store.decisionFor(widget, 'geolocation', CLIENT, firstSite)).toBeUndefined()

    // A page's own decision is not used for the site embedded in a page.
    await store.set(widget, 'geolocation', 'deny', { workspaceId: CLIENT })
    expect(store.decisionFor(widget, 'geolocation', CLIENT)).toBe('deny')
    expect(store.decisionFor(widget, 'geolocation', CLIENT, firstSite)).toBeUndefined()
    expect(store.decisionFor(widget, 'geolocation', WORK)).toBeUndefined()

    // A decision saved before decisions had a scope applies wherever the workspace has none of its own.
    await store.set(widget, 'geolocation', 'allow')
    expect(store.decisionFor(widget, 'geolocation', WORK)).toBe('allow')
    expect(store.decisionFor(widget, 'geolocation', WORK, secondSite)).toBe('allow')
    expect(store.decisionFor(widget, 'geolocation', CLIENT)).toBe('deny')
    expect(store.decisionFor(widget, 'geolocation', 'not-a-workspace')).toBeUndefined()

    // Only origins are kept, never a page's path or query.
    expect(store.list()).toEqual([
      { origin: widget, permission: 'geolocation', decision: 'allow' },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: WORK, embeddedIn: firstSite },
      { origin: widget, permission: 'geolocation', decision: 'deny', workspaceId: CLIENT }
    ])
    await expect(store.set(widget, 'geolocation', 'allow', { embeddedIn: firstSite })).rejects.toThrow('scope')
    await expect(store.set(widget, 'geolocation', 'allow', { workspaceId: WORK, embeddedIn: widget })).rejects.toThrow('scope')
    await expect(store.set(widget, 'geolocation', 'allow', { workspaceId: 'work' })).rejects.toThrow('scope')
  })

  it('drops a version 2 decision whose scope is malformed', async () => {
    const { path, store } = await createStore()
    await mkdir(dirname(path), { recursive: true })
    const valid = [
      { origin: widget, permission: 'geolocation', decision: 'allow' },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: WORK },
      { origin: widget, permission: 'geolocation', decision: 'deny', workspaceId: WORK, embeddedIn: firstSite }
    ]
    await writeFile(path, JSON.stringify({
      version: 2,
      permissions: [
        ...valid,
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: 'work' },
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: null },
        { origin: widget, permission: 'notifications', decision: 'allow', embeddedIn: firstSite },
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: WORK, embeddedIn: widget },
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: WORK, embeddedIn: `${firstSite}/page` },
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: WORK, embeddedIn: 'file:///tmp/page.html' },
        { origin: widget, permission: 'notifications', decision: 'allow', workspaceId: WORK, tabUrl: `${firstSite}/page` }
      ]
    }), 'utf8')
    expect(await store.load()).toEqual(valid)
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ version: 2, permissions: valid })
  })

  it('forgets a removed workspace’s decisions and saves none for it afterwards', async () => {
    const { path, store } = await createStore()
    await store.set(widget, 'geolocation', 'allow')
    await store.set(widget, 'geolocation', 'allow', { workspaceId: WORK })
    await store.set(widget, 'geolocation', 'deny', { workspaceId: CLIENT })
    await store.set(widget, 'notifications', 'allow', { workspaceId: CLIENT, embeddedIn: firstSite })
    // A change that arrives after the workspace went, such as a late answer, is not kept.
    const late = expect(store.set(widget, 'camera', 'allow', { workspaceId: CLIENT })).rejects.toThrow('removed')
    expect(await store.removeWorkspace(CLIENT)).toBe(2)
    await late
    await expect(store.set(widget, 'geolocation', 'allow', { workspaceId: CLIENT })).rejects.toThrow('removed')
    const kept = [
      { origin: widget, permission: 'geolocation', decision: 'allow' },
      { origin: widget, permission: 'geolocation', decision: 'allow', workspaceId: WORK }
    ]
    expect(store.list()).toEqual(kept)
    expect(await new SitePermissionStore(path).load()).toEqual(kept)
    expect(await store.removeWorkspace(CLIENT)).toBe(0)
    expect(await store.removeWorkspace('not-a-workspace')).toBe(0)
  })
})
