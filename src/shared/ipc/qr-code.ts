import type { EventChannel, InvokeChannel } from './channel.js'

/** Create QR Code, as in Chrome: main draws the code's image from the text the dialog shows. */
export const QR_CODE_IPC = {
  /** Shell → main: copies the image of the text's QR code. */
  copy: 'browser:copy-qr-code' as InvokeChannel<[text: string], void>,
  /** Shell → main: saves the image as a download from the tab's workspace, named after the address it was made for. */
  download: 'browser:download-qr-code' as InvokeChannel<[request: { tabId: string; text: string; address: string }], void>,
  /** Main → main window: Create QR Code in a page's menu, for the tab and the address of its page or image. */
  requested: 'browser:qr-code-requested' as EventChannel<[request: { tabId: string; address: string }]>
} as const
