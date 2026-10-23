import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { TabStateStore, WorkspaceMetadataError, type PersistedBrowserState } from '../src/main/browser/tab-store.js'
import { writeTextFileAtomically } from '../src/main/atomic-file.js'
import { discardObsoleteBrowserData } from '../src/main/obsolete-profile-data.js'
import { cleanExplicitlyDeletedWorkspaceStorage } from '../src/main/browser/workspace-storage-deletion.js'

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, readFile: vi.fn(actual.readFile) }
})
vi.mock('../src/main/atomic-file.js', async original => {
  const actual = await original<typeof import('../src/main/atomic-file.js')>()
  return { ...actual, writeTextFileAtomically: vi.fn(actual.writeTextFileAtomically) }
})
const roots: string[] = []
const empty: PersistedBrowserState = { version: 3, activeTabId: null, tabs: [], mcpTabGroups: [], savedTabGroups: [] }
afterEach(async () => { vi.clearAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'hronaut-metadata-')); roots.push(root)
  const path = join(root, 'tabs.json')
  return { root, path, store: new TabStateStore(path) }
}

it.each(['invalid-json', 'unsupported', 'non-record', 'invalid-schema', 'legacy', 'missing', 'valid-empty', 'read-error'])('preserves metadata baseline: %s', async fault => {
  const { path, store } = await fixture()
  const bytes = fault === 'invalid-json' ? '{synthetic-private-marker' : fault === 'non-record' ? 'null' : JSON.stringify({ ...empty, version: fault === 'unsupported' ? 999 : fault === 'legacy' ? 2 : 3, ...(fault === 'invalid-schema' ? { tabs: 'bad' } : {}) })
  if (fault === 'read-error') {
    await mkdir(path)
    await expect(store.load()).rejects.toMatchObject({ reason: 'unreadable' })
    expect((await lstat(path)).isDirectory()).toBe(true)
    await expect(store.save(empty)).rejects.toBeInstanceOf(WorkspaceMetadataError)
    return
  }
  if (fault !== 'missing') await writeFile(path, bytes)
  if (fault === 'missing' || fault === 'valid-empty') {
    expect(await store.load()).toEqual(fault === 'missing' ? null : { ...empty, allTabsMuted: false, allHumanInteractionLocked: false })
    await store.save(empty)
    expect(JSON.parse(await readFile(path, 'utf8')).version).toBe(3)
  } else {
    await expect(store.load()).rejects.toBeInstanceOf(WorkspaceMetadataError)
    expect(await readFile(path, 'utf8')).toBe(bytes)
    await expect(store.save(empty)).rejects.toBeInstanceOf(WorkspaceMetadataError)
    await expect(store.load()).rejects.not.toThrow('synthetic-private-marker')
    expect(await readFile(path, 'utf8')).toBe(bytes)
  }
})

it.each(['EACCES', 'ENOENT'])('does not turn a read error after lstat into a new profile: %s', async code => {
  const { path, store } = await fixture()
  await writeFile(path, JSON.stringify(empty))
  vi.mocked(readFile).mockRejectedValueOnce(Object.assign(new Error('private filesystem detail'), { code }))
  await expect(store.load()).rejects.toMatchObject({ reason: code === 'ENOENT' ? 'missing-after-validation' : 'unreadable' })
  await expect(store.save(empty)).rejects.toBeInstanceOf(WorkspaceMetadataError)
  expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(empty)
})

it('does not initialize over a dangling metadata link', async () => {
  const { path, store } = await fixture()
  await symlink(join(path, '..', 'absent'), path)
  await expect(store.load()).rejects.toMatchObject({ reason: 'unreadable' })
  expect((await lstat(path)).isSymbolicLink()).toBe(true)
})

it('does not invoke a queued snapshot after rejection, or reopen writes on a later load', async () => {
  const { path, store } = await fixture()
  let release!: () => void
  const hold = store.withStableSnapshot(() => new Promise<void>(resolve => { release = resolve }))
  await Promise.resolve()
  const snapshot = vi.fn(() => empty)
  const queued = store.save(snapshot)
  const rejected = expect(queued).rejects.toBeInstanceOf(WorkspaceMetadataError)
  await writeFile(path, '{private-invalid')
  await expect(store.load()).rejects.toBeInstanceOf(WorkspaceMetadataError)
  release(); await hold; await rejected
  expect(snapshot).not.toHaveBeenCalled()
  expect(await readFile(path, 'utf8')).toBe('{private-invalid')
  await writeFile(path, JSON.stringify(empty))
  await expect(store.load()).rejects.toBeInstanceOf(WorkspaceMetadataError)
  await expect(store.save(empty)).rejects.toBeInstanceOf(WorkspaceMetadataError)
})

it('checks rejection again at the atomic commit boundary', async () => {
  const { path, store } = await fixture()
  await writeFile(path, '{private-invalid')
  let entered!: () => void; let release!: () => void
  const start = new Promise<void>(resolve => { entered = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  vi.mocked(writeTextFileAtomically).mockImplementationOnce(async (_path, _contents, _mode, beforeCommit) => {
    entered(); await gate; beforeCommit?.(); throw new Error('commit must not be reached')
  })
  const save = store.save(empty); const rejected = expect(save).rejects.toBeInstanceOf(WorkspaceMetadataError)
  await start; await expect(store.load()).rejects.toBeInstanceOf(WorkspaceMetadataError)
  release(); await rejected
  expect(await readFile(path, 'utf8')).toBe('{private-invalid')
})

it('validates the complete schema before obsolete or explicit deletion can run', async () => {
  const { root, path } = await fixture()
  const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  for (const name of ['hronaut', `hronaut-workspace-${id}`]) {
    await mkdir(join(root, 'Partitions', name), { recursive: true })
    await writeFile(join(root, 'Partitions', name, 'marker'), 'synthetic-only')
  }
  const bytes = JSON.stringify({ ...empty, tabs: [{ id: 'invalid' }], deletedWorkspaceStorageIds: [id] })
  await writeFile(path, bytes)
  await expect(discardObsoleteBrowserData(root)).rejects.toMatchObject({ reason: 'invalid-schema' })
  for (const name of ['hronaut', `hronaut-workspace-${id}`]) expect(await readFile(join(root, 'Partitions', name, 'marker'), 'utf8')).toBe('synthetic-only')
  expect(await readFile(path, 'utf8')).toBe(bytes)
})

it('validates without repairing, then rereads retired intent before persisting repair', async () => {
  const { root, path, store } = await fixture()
  const id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
  // A description over its limit is repaired, so this load has something to write back.
  const workspace = { id: '01912345-6789-7abc-8def-0123456789ab', contextClass: 'standard', name: 'Personal', description: 'x'.repeat(1001), color: 'gray', createdAt: '2026-08-20T09:00:00.000Z', lastUsedAt: '2026-08-20T09:00:00.000Z', storageId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', navigationPolicy: { mode: 'unrestricted', rules: [] } }
  const bytes = JSON.stringify({ ...empty, mcpTabGroups: [workspace], deletedWorkspaceStorageIds: [id] })
  await writeFile(path, bytes)
  await store.load({ persistRepairs: false })
  expect(await readFile(path, 'utf8')).toBe(bytes)
  const cleanup = await cleanExplicitlyDeletedWorkspaceStorage(path, root, 'persist:hronaut')
  const saved = await store.load({ blockStorageCleanup: cleanup.metadataBlocked, requireExisting: true })
  // With no Partitions directory retirement is deferred, never invented.
  expect(saved?.deletedWorkspaceStorageIds).toEqual([id])
  await mkdir(join(root, 'Partitions'), { recursive: true })
  await cleanExplicitlyDeletedWorkspaceStorage(path, root, 'persist:hronaut')
  expect((await store.load({ requireExisting: true }))?.deletedWorkspaceStorageIds).toEqual([])
})

it('rejects disappearance after successful validation', async () => {
  const { path, store } = await fixture()
  await writeFile(path, JSON.stringify(empty)); await store.load({ persistRepairs: false }); await rm(path)
  await expect(store.load({ requireExisting: true })).rejects.toMatchObject({ reason: 'missing-after-validation' })
  await expect(store.save(empty)).rejects.toBeInstanceOf(WorkspaceMetadataError)
})

it.each(['before-replacement', 'after-replacement'])('latches initial-save failure %s without a shutdown retry', async phase => {
  const { path, store } = await fixture()
  const original = JSON.stringify(empty)
  await writeFile(path, original)
  await store.load()
  vi.mocked(writeTextFileAtomically).mockImplementationOnce(async (target, contents, _mode, beforeCommit, onCommitted) => {
    beforeCommit?.()
    if (phase === 'after-replacement') { await writeFile(target, contents); onCommitted?.() }
    throw new Error('synthetic private write error')
  })
  await expect(store.initializeState(() => ({ ...empty, allTabsMuted: true }))).rejects.toMatchObject({ reason: 'write-failed' })
  const retained = await readFile(path, 'utf8')
  if (phase === 'before-replacement') expect(retained).toBe(original)
  else expect(JSON.parse(retained).allTabsMuted).toBe(true)
  const snapshot = vi.fn(() => empty)
  await expect(store.save(snapshot)).rejects.toMatchObject({ reason: 'write-failed' })
  expect(snapshot).not.toHaveBeenCalled()
  expect(await readFile(path, 'utf8')).toBe(retained)
})
