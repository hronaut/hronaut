import { writeTextFileAtomically } from '../src/main/atomic-file.js'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertExclusiveWorkspaceStorage, cleanExplicitlyDeletedWorkspaceStorage } from '../src/main/browser/workspace-storage-deletion.js'

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, rm: vi.fn(actual.rm) }
})

vi.mock('../src/main/atomic-file.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/main/atomic-file.js')>()
  return { ...actual, writeTextFileAtomically: vi.fn(actual.writeTextFileAtomically) }
})

const deleted = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const active = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
const archived = 'cccccccc-1111-4111-8111-cccccccccccc'
const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-deletion-')); roots.push(root)
  const path = join(root, 'tabs.json')
  const directory = (id: string) => join(root, 'Partitions', `hronaut-workspace-${id}`)
  for (const id of [deleted, active, archived, 'home']) { await mkdir(directory(id), { recursive: true }); await writeFile(join(directory(id), 'canary'), id) }
  const state = { version: 3, tabs: [], mcpTabGroups: [{ id: 'active', storageId: active }], savedTabGroups: [{ id: 'archived', storageId: archived }], deletedWorkspaceStorageIds: [deleted] }
  await writeFile(path, JSON.stringify(state))
  const run = () => cleanExplicitlyDeletedWorkspaceStorage(path, root, 'persist:hronaut')
  return { root, path, directory, state, run }
}
async function exists(path: string) { return readFile(join(path, 'canary'), 'utf8').then(() => true, () => false) }

describe('explicit cold-start workspace storage deletion', () => {
  it('removes only committed targets, preserving active, archived, Home and unrecorded directories', async () => {
    const f = await fixture(); await mkdir(f.directory('unknown'))
    await f.run()
    await expect(stat(f.directory(deleted))).rejects.toMatchObject({ code: 'ENOENT' })
    for (const id of [active, archived, 'home']) expect(await exists(f.directory(id))).toBe(true)
    expect(await readdir(f.directory('unknown'))).toEqual([])
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([])
  })
  it('retries a crash after directory removal but before intent retirement', async () => {
    const f = await fixture(); await rm(f.directory(deleted), { recursive: true })
    await f.run(); await f.run()
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([])
  })
  it('retains a target still referenced at the pre-commit crash boundary', async () => {
    const f = await fixture(); f.state.mcpTabGroups.push({ id: 'not-committed', storageId: deleted.toUpperCase() })
    await writeFile(f.path, JSON.stringify(f.state)); await f.run()
    expect(await exists(f.directory(deleted))).toBe(true)
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([deleted])
  })
  it.each(['invalid-json', 'unknown-version', 'missing-storage-id', 'recovery-file', 'canonical-alias', 'sticky-block'])('defers ambiguous metadata: %s', async fault => {
    const f = await fixture(); const data = JSON.parse(JSON.stringify(f.state))
    if (fault === 'unknown-version') data.version = 999
    if (fault === 'missing-storage-id') delete data.savedTabGroups[0].storageId
    if (fault === 'canonical-alias') data.savedTabGroups.push({ id: 'alias', storageId: active.toUpperCase() })
    if (fault === 'sticky-block') data.workspaceStorageCleanupBlocked = true
    if (fault === 'recovery-file') await writeFile(`${f.path}.recovery`, '{}')
    await writeFile(f.path, fault === 'invalid-json' ? '{' : JSON.stringify(data))
    expect((await f.run()).metadataBlocked).toBe(true)
    expect(await exists(f.directory(deleted))).toBe(true)
  })
  it.each(['root', 'target', 'nested'])('rejects symlinks at %s and preserves outside files', async level => {
    const f = await fixture(); const outside = await mkdtemp(join(tmpdir(), 'hronaut-outside-')); roots.push(outside)
    await writeFile(join(outside, 'canary'), 'outside')
    const target = level === 'root' ? join(f.root, 'Partitions') : level === 'target' ? f.directory(deleted) : join(f.directory(deleted), 'link')
    await rm(target, { recursive: true, force: true }); await symlink(outside, target, 'dir')
    await f.run()
    expect(await readFile(join(outside, 'canary'), 'utf8')).toBe('outside')
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([deleted])
  })
  it('rejects traversal and Home as deletion records', async () => {
    const f = await fixture(); await writeFile(f.path, JSON.stringify({ ...f.state, deletedWorkspaceStorageIds: ['../outside', 'home'] }))
    expect((await f.run()).metadataBlocked).toBe(true)
    expect(await exists(f.directory('home'))).toBe(true)
  })
  it('rejects raw canonical aliases before live logical clearing', async () => {
    const f = await fixture(); f.state.savedTabGroups.push({ id: 'alias', storageId: active.toUpperCase() })
    await writeFile(f.path, JSON.stringify(f.state))
    await expect(assertExclusiveWorkspaceStorage(f.path, 'active', active)).rejects.toThrow()
  })
})


it('retains intent after partial removal failure and completes on a later startup', async () => {
  const f = await fixture()
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  vi.mocked(rm).mockImplementationOnce(async path => {
    await actual.rm(join(String(path), 'canary'))
    throw Object.assign(new Error('synthetic busy file'), { code: 'EBUSY' })
  })
  await f.run()
  expect((await stat(f.directory(deleted))).isDirectory()).toBe(true)
  expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([deleted])
  await f.run()
  await expect(stat(f.directory(deleted))).rejects.toMatchObject({ code: 'ENOENT' })
  expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([])
})


it.each(['before', 'after'] as const)('continues startup after cleanup retirement fails %s metadata commit', async phase => {
  const f = await fixture()
  const actual = await vi.importActual<typeof import('../src/main/atomic-file.js')>('../src/main/atomic-file.js')
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.mocked(writeTextFileAtomically).mockImplementationOnce(async (...args) => {
    if (phase === 'after') await actual.writeTextFileAtomically(...args)
    throw Object.assign(new Error('synthetic retirement failure'), { code: 'ENOSPC' })
  })
  try {
    await expect(f.run()).resolves.toEqual({ metadataBlocked: false })
    await expect(stat(f.directory(deleted))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await exists(f.directory(active))).toBe(true)
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual(phase === 'before' ? [deleted] : [])
    expect(warning).toHaveBeenCalledOnce()
    await f.run()
    expect(JSON.parse(await readFile(f.path, 'utf8')).deletedWorkspaceStorageIds).toEqual([])
  } finally { warning.mockRestore() }
})
