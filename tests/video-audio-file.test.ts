import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { mkdtemp, open, rm, symlink, writeFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readVideoAudioFile } from '../src/main/browser/video-audio-file.js'
import { VIDEO_AUDIO_LIMITS } from '../src/shared/video-audio.js'

vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, open: vi.fn(fs.open) }
})
const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
const directories: string[] = []
const sourcePath = resolve('private-audio.wav')
const failureMessage = 'Audio file could not be read. Select a non-empty regular file no larger than 10 MiB.'
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-audio-file-'))
  directories.push(directory)
  return directory
}

function file(contents: Buffer, size = contents.length, chunkSize = contents.length || 1) {
  const buffers: Buffer[] = []
  const handle = {
    stat: vi.fn(async () => ({ size, isFile: (): boolean => true })),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      buffers.push(buffer)
      const bytesRead = Math.max(0, Math.min(length, chunkSize, contents.length - position))
      contents.copy(buffer, offset, position, position + bytesRead)
      return { bytesRead }
    }),
    close: vi.fn(async () => {})
  }
  vi.mocked(open).mockResolvedValueOnce(handle as unknown as FileHandle)
  return { handle, buffers }
}

afterEach(async () => {
  vi.mocked(open).mockReset().mockImplementation(actualFs.open)
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

describe('bounded audio file reader', () => {
  it('reads a selected regular file without changing its contents', async () => {
    const path = join(await fixture(), 'clip.wav')
    const contents = Buffer.from([82, 73, 70, 70, 1, 2, 3, 4])
    await writeFile(path, contents)
    expect(await readVideoAudioFile(path, () => {})).toEqual(new Uint8Array(contents))
    expect(await actualFs.readFile(path)).toEqual(contents)
  })

  it('handles short reads, closes the descriptor and clears its scratch buffer', async () => {
    const contents = Buffer.from([0, 255, 20, 40, 100, 200, 12])
    const { handle, buffers } = file(contents, contents.length, 2)
    const result = await readVideoAudioFile(sourcePath, () => {})
    expect(result).toEqual(new Uint8Array(contents))
    expect(open).toHaveBeenCalledWith(sourcePath, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0))
    expect(handle.read.mock.calls.length).toBeGreaterThan(2)
    expect(buffers[0]!.every(byte => byte === 0)).toBe(true)
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('keeps reading the opened file if its pathname is replaced during stat', async () => {
    const directory = await fixture()
    const path = join(directory, 'clip.wav')
    await writeFile(path, 'selected bytes')
    vi.mocked(open).mockImplementationOnce(async (selectedPath, flags, mode) => {
      const handle = await actualFs.open(selectedPath, flags, mode)
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementationOnce(async () => {
        const result = await stat()
        await actualFs.rename(path, join(directory, 'original.wav'))
        await writeFile(path, 'replacement bytes')
        return result
      })
      return handle
    })
    expect(await readVideoAudioFile(path, () => {})).toEqual(new Uint8Array(Buffer.from('selected bytes')))
  })

  it.each(['relative.wav', 'file:///private/audio.wav', '/private/clip\0.wav', '//server/clip.wav', '\\\\server\\clip.wav'])('rejects unsupported path syntax before opening: %s', async path => {
    await expect(readVideoAudioFile(path, () => {})).rejects.toThrow(failureMessage)
    expect(open).not.toHaveBeenCalled()
  })

  it('returns a privacy-safe error for missing paths', async () => {
    const path = join(await fixture(), 'private-user-name.wav')
    await expect(readVideoAudioFile(path, () => {})).rejects.toThrow(failureMessage)
  })

  it('rejects directories', async () => {
    await expect(readVideoAudioFile(await fixture(), () => {})).rejects.toThrow(failureMessage)
  })

  it.skipIf(!constants.O_NOFOLLOW || process.platform === 'win32')('rejects a final symlink without reading its target', async () => {
    const directory = await fixture()
    const path = join(directory, 'link.wav')
    const target = join(directory, 'private-target.wav')
    await writeFile(target, 'private data')
    await symlink(target, path)
    await expect(readVideoAudioFile(path, () => {})).rejects.toThrow(failureMessage)
  })

  it.skipIf(process.platform === 'win32')('opens FIFOs without blocking and rejects them before reading', async () => {
    const path = join(await fixture(), 'pipe.wav')
    execFileSync('mkfifo', [path])
    await expect(readVideoAudioFile(path, () => {})).rejects.toThrow(failureMessage)
  })

  it.each([0, VIDEO_AUDIO_LIMITS.bytes + 1])('rejects an invalid declared size of %s before reading', async size => {
    const { handle } = file(Buffer.alloc(1), size)
    await expect(readVideoAudioFile(sourcePath, () => {})).rejects.toThrow(failureMessage)
    expect(handle.read).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('caps actual reads if the file grows after fstat', async () => {
    const { handle, buffers } = file(Buffer.alloc(VIDEO_AUDIO_LIMITS.bytes + 20, 45), 1)
    await expect(readVideoAudioFile(sourcePath, () => {})).rejects.toThrow(failureMessage)
    expect(handle.read).toHaveBeenCalledOnce()
    expect(handle.read.mock.calls[0]!.slice(1)).toEqual([0, VIDEO_AUDIO_LIMITS.bytes + 1, 0])
    expect(buffers[0]!.every(byte => byte === 0)).toBe(true)
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it('rejects a file truncated to zero after fstat', async () => {
    const { handle } = file(Buffer.alloc(0), 12)
    await expect(readVideoAudioFile(sourcePath, () => {})).rejects.toThrow(failureMessage)
    expect(handle.close).toHaveBeenCalledOnce()
  })

  it.each(['stat', 'read', 'close'] as const)('sanitizes %s errors and always attempts to close', async stage => {
    const { handle, buffers } = file(Buffer.from([1, 2, 3]))
    handle[stage].mockRejectedValueOnce(new Error(`EACCES: ${sourcePath}`))
    await expect(readVideoAudioFile(sourcePath, () => {})).rejects.toThrow(failureMessage)
    expect(handle.close).toHaveBeenCalledOnce()
    if (buffers[0]) expect(buffers[0].every(byte => byte === 0)).toBe(true)
  })

  it('checks authorization before opening anything', async () => {
    const cancelled = new Error('Cancelled')
    await expect(readVideoAudioFile(sourcePath, () => { throw cancelled })).rejects.toBe(cancelled)
    expect(open).not.toHaveBeenCalled()
  })

  it.each([2, 3, 4, 5, 6, 7, 8])('discards the result when authorization changes at validation %s', async failAt => {
    // Two one-byte reads plus EOF: open, stat, each read, and close must all
    // revalidate. The final check covers revocation while closing the handle.
    const { handle, buffers } = file(Buffer.from([1, 2]), 2, 1)
    const cancelled = new Error('Cancelled')
    let calls = 0
    await expect(readVideoAudioFile(sourcePath, () => { if (++calls === failAt) throw cancelled })).rejects.toBe(cancelled)
    expect(handle.close).toHaveBeenCalledOnce()
    if (buffers[0]) expect(buffers[0].every(byte => byte === 0)).toBe(true)
  })
})
