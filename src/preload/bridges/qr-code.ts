import { QR_CODE_IPC } from '../../shared/ipc/qr-code.js'
import type { HronautQrCodeApi } from '../../shared/types.js'
import { invoke, subscribe } from './ipc.js'

/** window.hronaut's Create QR Code. */
export const qrCodeApi: HronautQrCodeApi = {
  copyQrCode: (text) => invoke(QR_CODE_IPC.copy, text),
  downloadQrCode: (request) => invoke(QR_CODE_IPC.download, request),
  onQrCodeRequested: (listener) => subscribe(QR_CODE_IPC.requested, (request: unknown) => {
    const { tabId, address } = (request ?? {}) as Record<string, unknown>
    if (typeof tabId === 'string' && typeof address === 'string') listener({ tabId, address })
  })
}
