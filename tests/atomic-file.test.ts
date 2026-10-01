import { chmod, mkdtemp, open, readFile, readdir, rm, stat, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { writeTextFileAtomically } from '../src/main/atomic-file.js'

let directory: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

it.skipIf(process.platform === 'win32')('flushes the renamed directory entry after the file contents and closes the directory', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-directory-'))
  const path = join(directory, 'state.json')
  await writeFile(path, 'prior state', 'utf8')
  const probe = await open(path, 'r')
  const prototype = Object.getPrototypeOf(probe) as FileHandle
  await probe.close()
  const originalSync = prototype.sync
  const observed: string[] = []
  let directoryHandle: FileHandle | undefined
  vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
    if ((await this.stat()).isDirectory()) {
      directoryHandle = this
      observed.push(`directory:${await readFile(path, 'utf8')}`)
    } else {
      observed.push(`file:${await readFile(path, 'utf8')}`)
    }
    await originalSync.call(this)
  })

  await writeTextFileAtomically(path, 'new state')

  expect(observed).toEqual(['file:prior state', 'directory:new state'])
  expect(directoryHandle?.fd).toBe(-1)
})

it('preserves the prior state and removes the temporary file when its data flush fails', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-flush-'))
  const path = join(directory, 'state.json')
  await writeFile(path, 'prior state', 'utf8')
  const handle = await open(path, 'r')
  const prototype = Object.getPrototypeOf(handle) as typeof handle
  await handle.close()
  const sync = vi.spyOn(prototype, 'sync').mockRejectedValueOnce(new Error('Storage flush failed'))

  await expect(writeTextFileAtomically(path, 'new state')).rejects.toThrow('Storage flush failed')
  expect(sync).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toBe('prior state')
  expect(await readdir(directory)).toEqual(['state.json'])
})

it('flushes and replaces UTF-8 state with private permissions', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-success-'))
  const path = join(directory, 'nested', 'state.json')
  const handle = await open(join(directory, 'probe'), 'wx')
  const prototype = Object.getPrototypeOf(handle) as typeof handle
  await handle.close()
  const sync = vi.spyOn(prototype, 'sync')

  await writeTextFileAtomically(path, 'Hronaut — saved state\n')
  expect(sync).toHaveBeenCalledTimes(process.platform === 'win32' ? 1 : 2)
  expect(await readFile(path, 'utf8')).toBe('Hronaut — saved state\n')
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(await readdir(join(directory, 'nested'))).toEqual(['state.json'])
})

it.skipIf(process.platform === 'win32').each(['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EIO'])(
  'closes the directory after %s, tolerating only unsupported directory flushes', async (code) => {
    directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-directory-error-'))
    const path = join(directory, 'state.json')
    await writeFile(path, 'prior state', 'utf8')
    const probe = await open(path, 'r')
    const prototype = Object.getPrototypeOf(probe) as FileHandle
    await probe.close()
    const originalSync = prototype.sync
    let directoryHandle: FileHandle | undefined
    const failure = Object.assign(new Error('Directory flush failed'), { code })
    vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if ((await this.stat()).isDirectory()) {
        directoryHandle = this
        throw failure
      }
      await originalSync.call(this)
    })

    const write = writeTextFileAtomically(path, 'new state')
    if (code === 'EIO') await expect(write).rejects.toBe(failure)
    else await expect(write).resolves.toBeUndefined()

    expect(directoryHandle?.fd).toBe(-1)
    expect(await readFile(path, 'utf8')).toBe('new state')
    expect(await readdir(directory)).toEqual(['state.json'])
  }
)

it('retains the file flush on Windows without opening a directory handle', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-windows-'))
  const path = join(directory, 'state.json')
  const probe = await open(path, 'w')
  const prototype = Object.getPrototypeOf(probe) as FileHandle
  await probe.close()
  const sync = vi.spyOn(prototype, 'sync')
  vi.stubGlobal('process', { ...process, platform: 'win32' })

  await writeTextFileAtomically(path, 'new state')

  expect(sync).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toBe('new state')
})

it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('preserves saves into a writable directory without read permission', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-write-only-'))
  const path = join(directory, 'state.json')
  await chmod(directory, 0o300)
  try {
    await writeTextFileAtomically(path, 'new state')
    expect(await readFile(path, 'utf8')).toBe('new state')
  } finally {
    await chmod(directory, 0o700)
  }
})

it('preserves the destination and removes staged bytes when authorization is revoked before commit', async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-atomic-guard-'))
  const path = join(directory, 'reviewed.html')
  await writeFile(path, 'prior reviewed package', 'utf8')
  await expect(writeTextFileAtomically(path, 'cancelled package', 0o600, () => {
    throw new Error('Review discarded')
  })).rejects.toThrow('Review discarded')
  expect(await readFile(path, 'utf8')).toBe('prior reviewed package')
  expect(await readdir(directory)).toEqual(['reviewed.html'])
})
