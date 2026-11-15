import * as fs from 'node:fs'
import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadFolderWritable } from '../src/main/download-folder.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, accessSync: vi.fn(actual.accessSync), mkdirSync: vi.fn(actual.mkdirSync), openSync: vi.fn(actual.openSync) }
})

// A download into a download folder Hronaut could not write to, such as one on a drive that became read-only, ended as
// a bare Interrupted; Chrome asks where to save it instead, and makes a download folder that is gone again.

const platform = process.platform
let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hronaut-download-folder-writable-')) })
afterEach(async () => {
  Object.defineProperty(process, 'platform', { value: platform })
  vi.mocked(fs.accessSync).mockClear()
  vi.mocked(fs.mkdirSync).mockClear()
  vi.mocked(fs.openSync).mockClear()
  await rm(root, { recursive: true, force: true })
})

function onWindows(): void {
  Object.defineProperty(process, 'platform', { value: 'win32' })
}

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

  it('does not make a folder that is there, as Windows refuses to for a drive\'s root such as D:\\', () => {
    // Every download into a download folder at a drive's root asked where to save.
    vi.mocked(fs.mkdirSync).mockImplementation(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) })
    try {
      expect(downloadFolderWritable(root)).toBe(true)
      expect(fs.mkdirSync).not.toHaveBeenCalled()
    } finally {
      vi.mocked(fs.mkdirSync).mockReset()
    }
  })

  it('on Windows, makes a file there to tell, and leaves none behind', async () => {
    // Windows answers an access check on any folder as writable, whatever its permissions say.
    onWindows()
    expect(downloadFolderWritable(root)).toBe(true)
    expect(fs.accessSync).not.toHaveBeenCalled()
    expect(fs.openSync).toHaveBeenCalledWith(expect.stringMatching(/\.hronaut-[\da-f-]+\.tmp$/), 'wx')
    expect(await readdir(root)).toEqual([])
  })

  it('on Windows, says no when its permissions keep a file from being made there', () => {
    onWindows()
    vi.mocked(fs.openSync).mockImplementationOnce(() => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) })
    expect(downloadFolderWritable(root)).toBe(false)
  })
})
