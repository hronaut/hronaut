import { constants } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('node:fs/promises', () => ({ open: state.open }))
import { MAX_CREDENTIAL_IMPORT_BYTES, readCredentialImportFile } from '../src/main/credential-import-file.js'

function file(contents: Buffer, size = contents.length, chunkSize = contents.length || 1) {
  const buffers: Buffer[] = []
  const handle = {
    stat: vi.fn(async () => ({ size, isFile: () => true })),
    read: vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
      buffers.push(buffer)
      const bytesRead = Math.max(0, Math.min(length, chunkSize, contents.length - position))
      contents.copy(buffer, offset, position, position + bytesRead)
      return { bytesRead }
    }),
    close: vi.fn(async () => {})
  }
  state.open.mockResolvedValue(handle)
  return { handle, buffers }
}
beforeEach(() => state.open.mockReset())
describe('password import file reader', () => {
  it('handles short reads and clears the raw password buffer after decoding', async () => {
    const text = 'url,username,password\nhttps://example.test,person,sécret'
    const { handle, buffers } = file(Buffer.from(text), Buffer.byteLength(text), 3)
    expect(await readCredentialImportFile('/selected.csv')).toBe(text)
    expect(state.open).toHaveBeenCalledWith('/selected.csv', constants.O_RDONLY | constants.O_NONBLOCK)
    expect(handle.read.mock.calls.length).toBeGreaterThan(2)
    expect(buffers[0]!.every(byte => byte === 0)).toBe(true)
    expect(handle.close).toHaveBeenCalledTimes(1)
  })
  it('caps actual reads when a file grows after the size check', async () => {
    const { handle, buffers } = file(Buffer.alloc(MAX_CREDENTIAL_IMPORT_BYTES + 10, 65), 1)
    await expect(readCredentialImportFile('/growing.csv')).rejects.toThrow('too-large')
    expect(handle.read).toHaveBeenCalledTimes(1)
    expect(handle.read.mock.calls[0]!.slice(1)).toEqual([0, MAX_CREDENTIAL_IMPORT_BYTES + 1, 0])
    expect(buffers[0]!.every(byte => byte === 0)).toBe(true)
    expect(handle.close).toHaveBeenCalledTimes(1)
  })
  it('rejects nonregular files using a nonblocking open before reading', async () => {
    const { handle } = file(Buffer.alloc(0))
    handle.stat.mockResolvedValue({ size: 0, isFile: () => false })
    await expect(readCredentialImportFile('/selected-pipe')).rejects.toThrow('not-file')
    expect(state.open).toHaveBeenCalledWith('/selected-pipe', constants.O_RDONLY | constants.O_NONBLOCK)
    expect(handle.read).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledTimes(1)
  })
  it('rejects already oversized files without reading contents', async () => {
    const { handle } = file(Buffer.alloc(0), MAX_CREDENTIAL_IMPORT_BYTES + 1)
    await expect(readCredentialImportFile('/large.csv')).rejects.toThrow('too-large')
    expect(handle.read).not.toHaveBeenCalled()
    expect(handle.close).toHaveBeenCalledTimes(1)
  })
  it('closes the file and clears bytes when UTF-8 decoding fails', async () => {
    const { handle, buffers } = file(Buffer.from([0xff]))
    await expect(readCredentialImportFile('/invalid.csv')).rejects.toThrow()
    expect(buffers[0]!.every(byte => byte === 0)).toBe(true)
    expect(handle.close).toHaveBeenCalledTimes(1)
  })
})
