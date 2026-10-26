import { describe, expect, it, vi } from 'vitest'
import type { WebFrameMain } from 'electron'

// A fake system clipboard holding one PNG, and images whose size is the PNG's first two bytes.
const board = vi.hoisted(() => ({ png: undefined as Buffer | undefined }))

vi.mock('electron', () => {
  const image = (data: Buffer) => ({
    isEmpty: () => data.byteLength === 0,
    getSize: () => ({ width: data[0] ?? 0, height: data[1] ?? 0 }),
    toPNG: () => data
  })
  return {
    clipboard: {
      clear: () => { board.png = undefined },
      read: async () => board.png
        ? [{ types: ['image/png'], getType: async () => new Blob([new Uint8Array(board.png!)], { type: 'image/png' }) }]
        : [],
      write: async (items: Array<{ record: Record<string, Blob> }>) => {
        board.png = Buffer.from(await items[0]!.record['image/png']!.arrayBuffer())
      }
    },
    ClipboardItem: class { constructor(readonly record: Record<string, Blob>) {} },
    nativeImage: { createFromBuffer: image, createEmpty: () => image(Buffer.alloc(0)) }
  }
})

const { createClipboardOperations } = await import('../src/main/clipboard-operations.js')
const { LocalizedError } = await import('../src/main/localized-error.js')

function operations() {
  return createClipboardOperations({ text: (key) => key, mainWindow: () => null })
}

function videoFrame(gives: Buffer | undefined, state: { destroyed?: boolean, detached?: boolean } = {}) {
  return {
    isDestroyed: () => state.destroyed ?? false,
    get detached() { return state.detached ?? false },
    copyVideoFrameAt: vi.fn(() => { board.png = gives })
  }
}

describe('copying a video frame to the clipboard', () => {
  it('has the frame of the page copy the video frame at the page coordinates, then writes it back verified', async () => {
    const frame = videoFrame(Buffer.from([32, 18, 7]))
    await operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 300, 150)
    expect(frame.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(300, 150)
    expect(board.png).toEqual(Buffer.from([32, 18, 7]))
  })

  it('reports a video with no frame to give, after trying again', async () => {
    board.png = Buffer.from([1, 1, 1])
    const frame = videoFrame(undefined)
    const copy = operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 10, 20)
    await expect(copy).rejects.toBeInstanceOf(LocalizedError)
    await expect(copy).rejects.toMatchObject({ key: 'appErrors.clipboard.videoFrameRejected' })
    expect(frame.copyVideoFrameAt).toHaveBeenCalledTimes(3)
    // The earlier image does not pass for the frame.
    expect(board.png).toBeUndefined()
  })

  it('reports a frame the page removed without asking it to copy', async () => {
    const frame = videoFrame(Buffer.from([4, 4]), { detached: true })
    await expect(operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 10, 20))
      .rejects.toMatchObject({ key: 'appErrors.clipboard.pageClosed' })
    expect(frame.copyVideoFrameAt).not.toHaveBeenCalled()
  })
})
