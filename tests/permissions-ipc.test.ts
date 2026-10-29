import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '' }, session: { fromPartition: vi.fn() } }))

import { registerPermissionsIpc } from '../src/main/site-data/permissions-ipc.js'
import { SitePermissionStore } from '../src/main/site-data/site-permission-store.js'

const WORK = '01912345-6789-7abc-8def-0123456789ab'
const origin = 'https://widget.example'
const page = 'https://page.example'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

/** The permissions bridge over a store that holds a widget decision for its own page and one embedded in a page. */
async function createBridge() {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-permissions-ipc-test-'))
  temporaryDirectories.push(directory)
  const store = new SitePermissionStore(join(directory, 'site-permissions.json'))
  await store.load()
  await store.set(origin, 'geolocation', 'allow', { workspaceId: WORK })
  await store.set(origin, 'geolocation', 'allow', { workspaceId: WORK, embeddedIn: page })
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const publishSitePermissions = vi.fn()
  registerPermissionsIpc({ handle: (channel: string, listener: (...args: unknown[]) => unknown) => { handlers.set(channel, listener) } } as never, {
    assertTrustedSender: () => undefined,
    sitePermissionStore: () => store,
    publishSitePermissions
  })
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!({}, ...args))
  return { store, invoke, publishSitePermissions }
}

describe('permissions bridge', () => {
  it('changes and forgets exactly the decision a row names', async () => {
    const { store, invoke } = await createBridge()
    await expect(invoke('permissions:set', origin, 'geolocation', 'deny', { workspaceId: WORK, embeddedIn: `${page}/room?id=7` }))
      .resolves.toEqual({ origin, permission: 'geolocation', decision: 'deny', workspaceId: WORK, embeddedIn: page })
    expect(store.list().map((entry) => entry.decision)).toEqual(['allow', 'deny'])

    await expect(invoke('permissions:remove', origin, 'geolocation', { workspaceId: WORK })).resolves.toBe(true)
    expect(store.list()).toEqual([{ origin, permission: 'geolocation', decision: 'deny', workspaceId: WORK, embeddedIn: page }])
    await expect(invoke('permissions:list')).resolves.toEqual(store.list())
  })

  it.each([
    ['a scope that is not an object', 'workspace'],
    ['a list', [WORK]],
    ['no scope', undefined],
    ['null', null],
    ['an empty scope', {}],
    ['an unknown field', { workspaceId: WORK, tabId: 'tab' }],
    ['a workspace id of another form', { workspaceId: 'work' }],
    ['a workspace id that is not a version 7 UUID', { workspaceId: '01912345-6789-4abc-8def-0123456789ab' }],
    ['a workspace id that is not text', { workspaceId: 7 }],
    ['an embedding site without a workspace', { embeddedIn: page }],
    ['an embedding site that is the website itself', { workspaceId: WORK, embeddedIn: `${origin}/other` }],
    ['an embedding site that is not a website', { workspaceId: WORK, embeddedIn: 'file:///home/person/page.html' }],
    ['an embedding site that is not text', { workspaceId: WORK, embeddedIn: { origin: page } }]
  ])('refuses %s without changing any decision', async (_name, scope) => {
    // Every decision belongs to a workspace, so a change or Forget that names none, or a malformed one, names no decision.
    const { store, invoke, publishSitePermissions } = await createBridge()
    const before = store.list()
    await expect(invoke('permissions:set', origin, 'geolocation', 'deny', scope)).rejects.toThrow(TypeError)
    await expect(invoke('permissions:remove', origin, 'geolocation', scope)).rejects.toThrow(TypeError)
    expect(store.list()).toEqual(before)
    expect(publishSitePermissions).not.toHaveBeenCalled()
  })

  it('refuses a website or permission that is not one', async () => {
    const { store, invoke } = await createBridge()
    const before = store.list()
    await expect(invoke('permissions:set', 'hronaut://home', 'geolocation', 'deny', { workspaceId: WORK })).rejects.toThrow('HTTP or HTTPS origin')
    await expect(invoke('permissions:set', origin, 7, 'deny', { workspaceId: WORK })).rejects.toThrow(TypeError)
    await expect(invoke('permissions:set', origin, 'media', 'allow', { workspaceId: WORK })).rejects.toThrow('permission name')
    await expect(invoke('permissions:set', origin, 'geolocation', 'always', { workspaceId: WORK })).rejects.toThrow(TypeError)
    await expect(invoke('permissions:remove', 'javascript:alert(1)', 'geolocation', { workspaceId: WORK })).rejects.toThrow('HTTP or HTTPS origin')
    expect(store.list()).toEqual(before)
  })

  it('creates a decision for the workspace a change names', async () => {
    const { invoke, publishSitePermissions } = await createBridge()
    await expect(invoke('permissions:set', origin, 'notifications', 'allow', { workspaceId: WORK }))
      .resolves.toEqual({ origin, permission: 'notifications', decision: 'allow', workspaceId: WORK })
    expect(publishSitePermissions).toHaveBeenCalledOnce()
  })
})
