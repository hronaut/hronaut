import { describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'

vi.mock('electron', () => ({
  nativeImage: {
    createFromBitmap: (data: Buffer, size: { width: number }) => ({ toPNG: () => Buffer.concat([Buffer.from(`${size.width}:`), data.subarray(0, 64)]) })
  }
}))

const { registerQrCodeIpc } = await import('../src/main/qr-code-ipc.js')
const { qrCodePng } = await import('../src/main/browser/qr-code/qr-code-image.js')

// The Create QR Code dialog's Copy and Download ask main, which draws the image from the text and checks what it gets.

function harness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const trusted = { sender: 'shell' } as unknown as IpcMainInvokeEvent
  const page = { sender: 'page' } as unknown as IpcMainInvokeEvent
  const downloadGeneratedFile = vi.fn()
  const copyPngToClipboard = vi.fn(async () => ({ width: 1, height: 1 }))
  registerQrCodeIpc({
    assertTrustedSender: (event) => { if (event !== trusted) throw new Error('Untrusted sender') },
    handleBrowserIpc: (channel, listener) => { handlers.set(channel, listener as never) },
    tabs: () => ({ downloadGeneratedFile }),
    copyPngToClipboard
  })
  const invoke = async (channel: string, event: IpcMainInvokeEvent, value: unknown) => handlers.get(channel)!(event, value)
  return { invoke, trusted, page, downloadGeneratedFile, copyPngToClipboard }
}

describe('QR code IPC', () => {
  it('copies the image of the text\'s code', async () => {
    const { invoke, trusted, copyPngToClipboard } = harness()
    await invoke('browser:copy-qr-code', trusted, 'https://hronaut.dev/')
    expect(copyPngToClipboard).toHaveBeenCalledExactlyOnceWith(qrCodePng('https://hronaut.dev/'))
  })

  it('downloads the image from the tab, named after the address the dialog opened for', async () => {
    const { invoke, trusted, downloadGeneratedFile } = harness()
    await invoke('browser:download-qr-code', trusted, { tabId: 'tab-1', text: 'https://hronaut.dev/edited', address: 'https://hronaut.dev/' })
    expect(downloadGeneratedFile).toHaveBeenCalledExactlyOnceWith(
      'tab-1',
      `data:image/png;base64,${qrCodePng('https://hronaut.dev/edited')!.toString('base64')}`,
      'qrcode_hronaut.dev.png'
    )
  })

  it('refuses a page, text that is empty, not text or too long for a code, and a request of the wrong shape', async () => {
    const { invoke, trusted, page, downloadGeneratedFile, copyPngToClipboard } = harness()
    await expect(invoke('browser:copy-qr-code', page, 'https://hronaut.dev/')).rejects.toThrow('Untrusted sender')
    await expect(invoke('browser:download-qr-code', page, { tabId: 'tab-1', text: 'a', address: 'a' })).rejects.toThrow('Untrusted sender')
    for (const text of ['', 5, null, 'x'.repeat(8193)]) await expect(invoke('browser:copy-qr-code', trusted, text)).rejects.toThrow(TypeError)
    await expect(invoke('browser:copy-qr-code', trusted, 'x'.repeat(2332))).rejects.toThrow('The text is too long for a QR code')
    for (const request of [null, [], 'https://hronaut.dev/', { tabId: 1, text: 'a', address: 'a' }, { tabId: 'tab-1', text: 'a' }, { tabId: 'tab-1', text: 'a', address: 'x'.repeat(8193) }, { tabId: 'tab-1', text: '', address: 'a' }]) {
      await expect(invoke('browser:download-qr-code', trusted, request), JSON.stringify(request)?.slice(0, 60)).rejects.toThrow(TypeError)
    }
    expect(copyPngToClipboard).not.toHaveBeenCalled()
    expect(downloadGeneratedFile).not.toHaveBeenCalled()
  })
})
