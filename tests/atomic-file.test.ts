import { mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { writeTextFileAtomically } from '../src/main/atomic-file.js'

let directory: string | undefined
afterEach(async () => {
  vi.restoreAllMocks()
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
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
  expect(sync).toHaveBeenCalledOnce()
  expect(await readFile(path, 'utf8')).toBe('Hronaut — saved state\n')
  if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  expect(await readdir(join(directory, 'nested'))).toEqual(['state.json'])
})
