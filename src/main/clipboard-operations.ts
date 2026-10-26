import { clipboard, ClipboardItem, nativeImage, type BrowserWindow, type NativeImage, type WebContents, type WebFrameMain } from 'electron'
import { writeVerifiedClipboardText } from './verified-clipboard.js'
import { LocalizedError, personErrorMessage } from './localized-error.js'
import type { MessageKey, MessageParameters } from '../shared/i18n.js'

interface ClipboardOperationsHost {
  /** Translates into the current interface language; read on every use because the language can change. */
  text(key: MessageKey, parameters?: MessageParameters): string
  /** The main window, told when a copy failed; read on every use because it opens after startup and can close. */
  mainWindow(): Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null
}

/**
 * Copying text and images to the system clipboard, one operation at a time, each read back to confirm the clipboard
 * accepted it. A page image or video frame is copied by the page and then written again as a verified PNG.
 */
export function createClipboardOperations(host: ClipboardOperationsHost): {
  copyTextToClipboard(text: string): Promise<void>
  reportClipboardFailure(error: unknown): void
  copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }>
  copyPageImageToClipboard(webContents: WebContents, x: number, y: number): Promise<void>
  copyVideoFrameToClipboard(frame: WebFrameMain, x: number, y: number): Promise<void>
} {
  let clipboardOperationQueue: Promise<void> = Promise.resolve()

  function queueClipboardOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = clipboardOperationQueue.then(operation)
    clipboardOperationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async function copyTextToClipboard(text: string): Promise<void> {
    await queueClipboardOperation(async () => {
      await writeVerifiedClipboardText(text, clipboard)
    })
  }

  function reportClipboardFailure(error: unknown): void {
    const message = error instanceof Error ? personErrorMessage(error, host.text) : host.text('native.errors.clipboard')
    if (host.mainWindow() && !host.mainWindow()!.isDestroyed() && !host.mainWindow()!.webContents.isDestroyed()) {
      host.mainWindow()!.webContents.send('clipboard:failed', message)
    }
  }

  async function readClipboardImage(): Promise<NativeImage> {
    const items = await clipboard.read()
    const item = items.find((entry) => entry.types.includes('image/png'))
    if (!item) return nativeImage.createEmpty()
    const blob = await item.getType('image/png')
    if (!(blob instanceof Blob)) throw new Error('The clipboard PNG payload was not an image')
    return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
  }

  async function writePngToClipboard(data: Buffer): Promise<{ width: number; height: number }> {
    const image = nativeImage.createFromBuffer(data)
    if (image.isEmpty()) throw new Error(host.text('native.errors.screenshotCreate'))
    const expectedSize = image.getSize()

    for (let attempt = 0; attempt < 3; attempt += 1) {
      // Do not let a previous image with the same dimensions masquerade as a
      // successful write when the platform clipboard silently rejects this one.
      clipboard.clear()
      await clipboard.write([new ClipboardItem({
        'image/png': new Blob([new Uint8Array(data)], { type: 'image/png' })
      })])
      await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
      const copied = await readClipboardImage()
      const copiedSize = copied.getSize()
      if (
        !copied.isEmpty()
        && copied.toPNG().byteLength > 0
        && copiedSize.width === expectedSize.width
        && copiedSize.height === expectedSize.height
      ) {
        return copiedSize
      }
    }

    throw new LocalizedError('appErrors.clipboard.screenshotRejected')
  }

  async function copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }> {
    return queueClipboardOperation(() => writePngToClipboard(data))
  }

  /** Has the page copy an image itself, then reads it back and writes it again as a verified PNG. */
  async function copyImageThePageGives(
    pageGone: () => boolean,
    copy: () => void,
    rejected: 'appErrors.clipboard.imageRejected' | 'appErrors.clipboard.videoFrameRejected'
  ): Promise<void> {
    await queueClipboardOperation(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (pageGone()) throw new LocalizedError('appErrors.clipboard.pageClosed')
        clipboard.clear()
        copy()
        await new Promise<void>((resolve) => setTimeout(resolve, 40 * (attempt + 1)))
        const image = await readClipboardImage()
        if (!image.isEmpty()) {
          const png = image.toPNG()
          if (png.byteLength > 0) {
            await writePngToClipboard(png)
            return
          }
        }
      }
      throw new LocalizedError(rejected)
    })
  }

  async function copyPageImageToClipboard(webContents: WebContents, x: number, y: number): Promise<void> {
    await copyImageThePageGives(() => webContents.isDestroyed(), () => webContents.copyImageAt(x, y), 'appErrors.clipboard.imageRejected')
  }

  /**
   * Copies the frame a video shows at (x, y), in the page's coordinates, from the frame of the page the video is in.
   * A video with no frame to give, such as one not loaded yet, copies nothing, which reads as a rejected copy.
   */
  async function copyVideoFrameToClipboard(frame: WebFrameMain, x: number, y: number): Promise<void> {
    await copyImageThePageGives(() => frame.isDestroyed() || frame.detached, () => frame.copyVideoFrameAt(x, y), 'appErrors.clipboard.videoFrameRejected')
  }

  return { copyTextToClipboard, reportClipboardFailure, copyPngToClipboard, copyPageImageToClipboard, copyVideoFrameToClipboard }
}
