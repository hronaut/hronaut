import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm, symlink, rename, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it as test } from 'vitest'
const it = test.skipIf(process.platform !== 'linux')
import { AcquisitionPool, MAX_SOURCE_BYTES } from './helpers/file-source-acquisition-prototype.js'
const dirs: string[] = []
const digest = (source: string | Buffer): string => createHash('sha256').update(source).digest('hex')
const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
async function fixture(source: string | Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'hronaut-source-probe-')); dirs.push(dir)
  const path = join(dir, 'source.js'); await writeFile(path, source); return path
}
afterEach(async () => { await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
it('captures exact Unicode, BOM, syntax and 64 KiB without normalization', async () => {
  for (const source of ['', '\ufeffconst x = `🛰️\\n`;\n/quote/.test("é")', 'x'.repeat(MAX_SOURCE_BYTES)]) {
    expect(await new AcquisitionPool().acquire(await fixture(source), digest(source))).toBe(source)
  }
})
it('rejects invalid UTF-8, overflow and digest mismatch without reflecting source/path', async () => {
  for (const [source, code] of [[Buffer.from([0xc0, 0xaf]), 'INVALID_UTF8'], [Buffer.alloc(MAX_SOURCE_BYTES + 1), 'TOO_LARGE']] as const) {
    await expect(new AcquisitionPool().acquire(await fixture(source), digest(source))).rejects.toThrow(code)
  }
  const path = await fixture('private source')
  const failure = await new AcquisitionPool().acquire(path, digest('other')).catch(error => error as Error)
  expect(failure).toMatchObject({ message: 'DIGEST_MISMATCH' })
  expect(failure).not.toHaveProperty('cause')
  expect(JSON.stringify(failure)).not.toContain(path)
  expect(JSON.stringify(failure)).not.toContain('private source')
})
it('rejects noncanonical, Windows/UNC paths and unsupported platform before IO', async () => {
  for (const path of ['relative', '//server/share', '/tmp/../tmp/x', '/tmp//x', 'C:\\x', '/tmp/x\0']) await expect(new AcquisitionPool().acquire(path, digest(''))).rejects.toThrow('INVALID_PATH')
  await expect(new AcquisitionPool({}, 'win32').acquire('/tmp/x', digest(''))).rejects.toThrow('UNSUPPORTED_PLATFORM')
})
it('rejects leaf and ancestor symlinks, directories, FIFO and device without opening data', async () => {
  const path = await fixture('x'); const dir = join(path, '..')
  await symlink(path, join(dir, 'link')); await symlink(dir, join(dir, 'parent'))
  execFileSync('mkfifo', [join(dir, 'pipe')])
  for (const target of [join(dir, 'link'), join(dir, 'parent/source.js'), dir, join(dir, 'pipe'), '/dev/null']) await expect(new AcquisitionPool().acquire(target, digest('x'))).rejects.toThrow('INVALID_FILE_TYPE')
})
it('rejects a detected rename during capture without reading the replacement', async () => {
  const path = await fixture('original'); let replaced = false
  const pool = new AcquisitionPool({ afterRead: async () => {
    if (replaced) return
    replaced = true; await rename(path, `${path}.old`); await writeFile(path, 'replacement')
  } })
  // Rename changes ctime: conservative change detection rejects, never captures replacement.
  await expect(pool.acquire(path, digest('original'))).rejects.toThrow('FILE_CHANGED')
})
it('bounds concurrent native work after caller cancellation and closes late handles', async () => {
  const path = await fixture('x'); const release = deferred(); const entered = deferred(); const handles: FileHandle[] = []
  const pool = new AcquisitionPool({ afterOpen: async handle => { handles.push(handle); if (handles.length === 2) entered.resolve(); await release.promise } })
  const controllers = [new AbortController(), new AbortController()]
  const calls = controllers.map(controller => pool.acquire(path, digest('x'), controller.signal))
  const settlements = calls.map(call => expect(call).rejects.toThrow('CANCELLED'))
  await entered.promise; controllers.forEach(controller => controller.abort()); await Promise.all(settlements)
  expect(pool.active).toBe(2)
  await expect(pool.acquire(path, digest('x'))).rejects.toThrow('BUSY')
  release.resolve(); await expect.poll(() => pool.active).toBe(0)
  expect(handles.every(handle => handle.fd === -1)).toBe(true)
})
it('deadline stops delivery but retains slot until real read completion and cleanup', async () => {
  const path = await fixture('x'); const release = deferred(); const entered = deferred(); const handles: FileHandle[] = []
  const pool = new AcquisitionPool({ afterOpen: async handle => { handles.push(handle) }, afterRead: async () => { entered.resolve(); await release.promise } })
  const call = pool.acquire(path, digest('x'), undefined, 1000)
  const rejected = expect(call).rejects.toThrow('DEADLINE')
  await entered.promise; await rejected; expect(pool.active).toBe(1)
  release.resolve(); await expect.poll(() => pool.active).toBe(0)
  expect(handles.every(handle => handle.fd === -1)).toBe(true)
})
it('pre-aborted requests consume no slot or handles', async () => {
  const controller = new AbortController(); controller.abort(); const pool = new AcquisitionPool()
  await expect(pool.acquire('/tmp/unused', digest(''), controller.signal)).rejects.toThrow('CANCELLED'); expect(pool.active).toBe(0)
})
it('detects growth beyond the cap during capture without extending the buffer', async () => {
  const path = await fixture('x'); let changed = false
  const pool = new AcquisitionPool({ afterRead: async () => {
    if (changed) return
    changed = true; await writeFile(path, Buffer.alloc(MAX_SOURCE_BYTES + 20, 120))
  } })
  await expect(pool.acquire(path, digest('x'))).rejects.toThrow('TOO_LARGE')
  expect(pool.active).toBe(0)
})
it('cancellation after a real read rejects delivery and drains owned handles', async () => {
  const path = await fixture('x'); const controller = new AbortController(); const handles: FileHandle[] = []
  const pool = new AcquisitionPool({ afterOpen: async handle => { handles.push(handle) }, afterRead: async () => { controller.abort() } })
  await expect(pool.acquire(path, digest('x'), controller.signal)).rejects.toThrow('CANCELLED')
  await expect.poll(() => pool.active).toBe(0)
  expect(handles.every(handle => handle.fd === -1)).toBe(true)
})
it('quarantines a slot on an injected close failure without retrying that descriptor', async () => {
  const path = await fixture('x'); let originalClose: (() => Promise<void>) | undefined; let attempts = 0; let uncertainHandle: FileHandle | undefined
  const pool = new AcquisitionPool({ afterOpen: async handle => {
    if (originalClose) return
    uncertainHandle = handle
    originalClose = handle.close.bind(handle)
    handle.close = async () => { attempts++; throw new Error('private path and content') }
  } })
  try {
    await expect(pool.acquire(path, digest('x'))).rejects.toThrow('CLEANUP_UNKNOWN')
    expect(attempts).toBe(1); expect(pool.active).toBe(1)
    expect([...pool.quarantinedHandles]).toEqual([uncertainHandle])
  } finally { await originalClose?.() }
})
