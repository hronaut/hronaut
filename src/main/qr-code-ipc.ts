import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { BrowserTabsManager } from './browser/tabs-manager.js'
import { qrCodeFilename, qrCodePng } from './browser/qr-code/qr-code-image.js'

/** Longer text than this, in UTF-16 code units, holds more than the largest QR code can anyway. */
const QR_CODE_TEXT_MAX_LENGTH = 8192

type QrCodeIpcTabs = Pick<BrowserTabsManager, 'downloadGeneratedFile'>

interface QrCodeIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** Registers a handler that is refused while saved workspaces are still initializing or failed to start. */
  handleBrowserIpc(channel: string, listener: Parameters<IpcMain['handle']>[1]): void
  tabs(): QrCodeIpcTabs | null
  /** Writes a PNG image to the system clipboard after earlier clipboard writes; resolves to its size. */
  copyPngToClipboard(data: Buffer): Promise<{ width: number; height: number }>
}

/**
 * The Create QR Code dialog's Copy and Download, as in Chrome: main draws the code's image from the text, copies it, or
 * saves it as a download from the tab's workspace, named after the address the dialog opened for. Dependencies stay
 * lazy because handlers are registered before the window loads.
 */
export function registerQrCodeIpc(host: QrCodeIpcHost): void {
  host.handleBrowserIpc('browser:copy-qr-code', async (event, text: unknown) => {
    host.assertTrustedSender(event)
    await host.copyPngToClipboard(qrCodeImage(text))
  })
  host.handleBrowserIpc('browser:download-qr-code', (event, value: unknown) => {
    host.assertTrustedSender(event)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Invalid QR code request')
    const { tabId, text, address } = value as Record<string, unknown>
    if (typeof tabId !== 'string' || typeof address !== 'string' || address.length > QR_CODE_TEXT_MAX_LENGTH) throw new TypeError('Invalid QR code request')
    const image = qrCodeImage(text)
    host.tabs()!.downloadGeneratedFile(tabId, `data:image/png;base64,${image.toString('base64')}`, qrCodeFilename(address))
  })
}

function qrCodeImage(text: unknown): Buffer {
  if (typeof text !== 'string' || !text || text.length > QR_CODE_TEXT_MAX_LENGTH) throw new TypeError('Invalid QR code request')
  const image = qrCodePng(text)
  if (!image) throw new TypeError('The text is too long for a QR code')
  return image
}
