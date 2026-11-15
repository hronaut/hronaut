import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WebContents, WebFrameMain } from 'electron'

// A fake system clipboard holding items by media type, and images whose size is the PNG's first two bytes.
const board = vi.hoisted(() => ({ items: [] as Array<Record<string, Blob | string>>, rejects: undefined as Buffer | undefined }))

vi.mock('electron', () => {
  const image = (data: Buffer) => ({
    isEmpty: () => data.byteLength === 0,
    getSize: () => ({ width: data[0] ?? 0, height: data[1] ?? 0 }),
    toPNG: () => data
  })
  return {
    clipboard: {
      clear: () => { board.items = [] },
      read: async () => board.items.map(record => ({ types: Object.keys(record), getType: async (type: string) => record[type] })),
      write: async (items: Array<{ record: Record<string, Blob | string> }>) => {
        // A clipboard that does not take one image, as a system clipboard can.
        const png = items[0]?.record['image/png']
        if (board.rejects && png instanceof Blob && Buffer.from(await png.arrayBuffer()).equals(board.rejects)) return
        board.items = items.map(item => item.record)
      }
    },
    ClipboardItem: class { constructor(readonly record: Record<string, Blob | string>) {} },
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
    copyVideoFrameAt: vi.fn(() => {
      board.items = gives ? [{ 'image/png': new Blob([new Uint8Array(gives)], { type: 'image/png' }) }] : []
    })
  }
}

async function clipboardPng(): Promise<Buffer | undefined> {
  const png = board.items[0]?.['image/png']
  return png instanceof Blob ? Buffer.from(await png.arrayBuffer()) : undefined
}

beforeEach(() => {
  board.items = []
  board.rejects = undefined
})

describe('copying a video frame to the clipboard', () => {
  it('has the frame of the page copy the video frame at the page coordinates, then writes it back verified', async () => {
    const frame = videoFrame(Buffer.from([32, 18, 7]))
    await operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 300, 150)
    expect(frame.copyVideoFrameAt).toHaveBeenCalledExactlyOnceWith(300, 150)
    expect(await clipboardPng()).toEqual(Buffer.from([32, 18, 7]))
  })

  it('reports a video with no frame to give, after trying again, and leaves what was copied before', async () => {
    // A failed copy emptied the clipboard, so the text the person had copied was lost.
    board.items = [{ 'text/plain': 'order 7' }]
    const frame = videoFrame(undefined)
    const copy = operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 10, 20)
    await expect(copy).rejects.toBeInstanceOf(LocalizedError)
    await expect(copy).rejects.toMatchObject({ key: 'appErrors.clipboard.videoFrameRejected' })
    expect(frame.copyVideoFrameAt).toHaveBeenCalledTimes(3)
    expect(board.items).toEqual([{ 'text/plain': 'order 7' }])
  })

  it('leaves what was copied before when the clipboard does not take the frame', async () => {
    const earlier = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' })
    board.items = [{ 'image/png': earlier }]
    board.rejects = Buffer.from([32, 18, 7])
    const frame = videoFrame(Buffer.from([32, 18, 7]))
    await expect(operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 10, 20))
      .rejects.toMatchObject({ key: 'appErrors.clipboard.screenshotRejected' })
    expect(board.items).toEqual([{ 'image/png': earlier }])
  })

  it('reports a canvas with no picture to give as the canvas\'s, and an image as the image\'s', async () => {
    // A canvas that gave nothing read as if the system clipboard had refused its picture.
    const page = { isDestroyed: () => false, copyImageAt: vi.fn() }
    await expect(operations().copyPageImageToClipboard(page as unknown as WebContents, 10, 20, 'canvas'))
      .rejects.toMatchObject({ key: 'appErrors.clipboard.canvasRejected' })
    expect(page.copyImageAt).toHaveBeenCalledWith(10, 20)
    await expect(operations().copyPageImageToClipboard(page as unknown as WebContents, 10, 20))
      .rejects.toMatchObject({ key: 'appErrors.clipboard.imageRejected' })
  })

  it('reports a frame the page removed without asking it to copy or touching the clipboard', async () => {
    board.items = [{ 'text/plain': 'order 7' }]
    const frame = videoFrame(Buffer.from([4, 4]), { detached: true })
    await expect(operations().copyVideoFrameToClipboard(frame as unknown as WebFrameMain, 10, 20))
      .rejects.toMatchObject({ key: 'appErrors.clipboard.pageClosed' })
    expect(frame.copyVideoFrameAt).not.toHaveBeenCalled()
    expect(board.items).toEqual([{ 'text/plain': 'order 7' }])
  })
})

describe('copying a page image to the clipboard', () => {
  it('keeps the image markup the page wrote beside the picture, as Chrome does', async () => {
    const markup = '<img src="https://shop.example/dot.png" alt="Green dot"/>'
    const webContents = {
      isDestroyed: () => false,
      copyImageAt: vi.fn(() => {
        board.items = [{ 'image/png': new Blob([new Uint8Array([6, 4, 1])], { type: 'image/png' }), 'text/html': new Blob([markup], { type: 'text/html' }) }]
      })
    }
    await operations().copyPageImageToClipboard(webContents as unknown as Electron.WebContents, 30, 40)
    expect(webContents.copyImageAt).toHaveBeenCalledExactlyOnceWith(30, 40)
    expect(await clipboardPng()).toEqual(Buffer.from([6, 4, 1]))
    // Only the PNG was written back, so pasting into a rich text editor lost the image's address.
    const html = board.items[0]?.['text/html']
    expect(html instanceof Blob ? await html.text() : html).toBe(markup)
  })
})
