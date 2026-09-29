import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeUniqueDownloadFile } from '../src/main/browser/unique-download-file.js'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const directories: string[] = []
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-export-test-'))
  directories.push(directory)
  return directory
}
afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(actualFs.open)
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('unique export file writer', () => {
  it('removes a partially written file and permits a retry with the same name', async () => {
    const directory = await fixture()
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode)
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await handle.write(Buffer.from('partial'))
        throw failure
      })
      return handle
    })
    await expect(writeUniqueDownloadFile(directory, 'page.pdf', Buffer.from('complete'))).rejects.toBe(failure)
    expect(await readdir(directory)).toEqual([])

    const path = await writeUniqueDownloadFile(directory, 'page.pdf', Buffer.from('complete'))
    expect(path).toBe(join(directory, 'page.pdf'))
    expect(await readFile(path, 'utf8')).toBe('complete')
  })

  it('preserves existing files and allocates distinct names for concurrent exports', async () => {
    const directory = await fixture()
    await writeFile(join(directory, 'network.har'), 'existing')
    const paths = await Promise.all(['first', 'second'].map(value =>
      writeUniqueDownloadFile(directory, 'network.har', Buffer.from(value))))
    expect(new Set(paths).size).toBe(2)
    expect(await readFile(join(directory, 'network.har'), 'utf8')).toBe('existing')
    expect(await Promise.all(paths.map(path => readFile(path, 'utf8')))).toEqual(['first', 'second'])
    expect((await readdir(directory)).sort()).toEqual(['network (1).har', 'network (2).har', 'network.har'])
  })

  it('removes the owned file if export authorization changes during the write', async () => {
    const directory = await fixture()
    const failure = new Error('export cancelled')
    let current = true
    vi.mocked(open).mockImplementationOnce(async (path, flags, mode) => {
      const handle = await actualFs.open(path, flags, mode)
      const write = handle.writeFile.bind(handle)
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async data => {
        await write(data)
        current = false
      })
      return handle
    })
    await expect(writeUniqueDownloadFile(directory, 'recording.webm', Buffer.from('video'), () => {
      if (!current) throw failure
    })).rejects.toBe(failure)
    expect(await readdir(directory)).toEqual([])
  })

  it('preserves a replacement file when the partial export was moved during a failed write', async () => {
    const directory = await fixture()
    const path = join(directory, 'page.pdf')
    const moved = join(directory, 'moved-partial.pdf')
    const failure = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    vi.mocked(open).mockImplementationOnce(async (file, flags, mode) => {
      const handle = await actualFs.open(file, flags, mode)
      vi.spyOn(handle, 'writeFile').mockImplementationOnce(async () => {
        await handle.write(Buffer.from('partial'))
        await actualFs.rename(path, moved)
        await writeFile(path, 'replacement contents')
        throw failure
      })
      return handle
    })

    await expect(writeUniqueDownloadFile(directory, 'page.pdf', Buffer.from('export'))).rejects.toBe(failure)

    expect(await readFile(path, 'utf8')).toBe('replacement contents')
    expect(await readFile(moved, 'utf8')).toBe('partial')
  })

  it('does not delete a destination when exclusive creation fails', async () => {
    const directory = await fixture()
    const path = join(directory, 'page.pdf')
    await writeFile(path, 'existing')
    const failure = Object.assign(new Error('access denied'), { code: 'EACCES' })
    vi.mocked(open).mockRejectedValueOnce(failure)
    await expect(writeUniqueDownloadFile(directory, 'page.pdf', Buffer.from('new'))).rejects.toBe(failure)
    expect(await readFile(path, 'utf8')).toBe('existing')
  })
})
