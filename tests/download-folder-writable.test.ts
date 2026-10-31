import * as fs from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFolderWritable } from '../src/main/download-folder.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, accessSync: vi.fn(actual.accessSync) }
})

// A download into a download folder Hronaut could not write to, such as one on a drive that became read-only, ended as
// a bare Interrupted; Chrome asks where to save it instead, and makes a download folder that is gone again.

let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-download-folder-writable-')) })
afterEach(async () => {
  vi.mocked(fs.accessSync).mockClear()
  await rm(root, { recursive: true, force: true })
})

describe('whether a download can be saved in the download folder', () => {
  it('makes a download folder that is gone again, as Chrome does', async () => {
    const folder = join(root, 'Downloads', 'Hronaut')
    expect(downloadFolderWritable(folder)).toBe(true)
    expect((await stat(folder)).isDirectory()).toBe(true)
  })

  it('says no when a file stands where the folder should be', async () => {
    await writeFile(join(root, 'Downloads'), '')
    expect(downloadFolderWritable(join(root, 'Downloads'))).toBe(false)
    expect(downloadFolderWritable(join(root, 'Downloads', 'Hronaut'))).toBe(false)
  })

  it('says no when Hronaut may not write to the folder', () => {
    vi.mocked(fs.accessSync).mockImplementationOnce(() => { throw Object.assign(new Error('EROFS'), { code: 'EROFS' }) })
    expect(downloadFolderWritable(root)).toBe(false)
    expect(fs.accessSync).toHaveBeenCalledWith(root, fs.constants.W_OK)
  })
})
