import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import QrCodeDialog from '../../src/renderer/src/components/QrCodeDialog.vue'
import { useQrCodeDialogController } from '../../src/renderer/src/composables/useQrCodeDialogController.js'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { qrCodePath } from '../../src/shared/qr-code-path.js'
import { qrCode } from '../../src/shared/qr-code.js'

// Hronaut had no Create QR Code, as Chrome has in the page's and an image's context menu: a dialog with the address's
// QR code, which the person can edit, copy or download.

function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((next, fail) => { resolve = next; reject = fail })
  return { promise, resolve, reject }
}

function harness() {
  const tabIds = ref<readonly string[]>(['tab-1', 'tab-2'])
  const api = {
    copyQrCode: vi.fn(async (_text: string): Promise<void> => undefined),
    downloadQrCode: vi.fn(async (_request: { tabId: string, text: string, address: string }): Promise<void> => undefined)
  }
  const beforeOpen = vi.fn()
  const controller = useQrCodeDialogController({ api, tabIds, beforeOpen, formatError: (error) => `Failed: ${(error as Error).message}` })
  return { api, tabIds, beforeOpen, controller }
}

describe('the QR code path', () => {
  it('draws one rectangle for each run of dark modules in a row', () => {
    expect(qrCodePath([[true, true, false, true], [false, false, false, false], [true, false, false, false]]))
      .toBe('M0 0h2v1h-2zM3 0h1v1h-1zM0 2h1v1h-1z')
  })
})

describe('the QR code dialog controller', () => {
  it('opens for an address, after closing what it would cover, and draws its code', () => {
    const { controller, beforeOpen } = harness()
    controller.openFor({ tabId: 'tab-1', address: 'https://hronaut.dev/' })
    expect(beforeOpen).toHaveBeenCalledOnce()
    expect(controller.open.value).toBe(true)
    expect(controller.text.value).toBe('https://hronaut.dev/')
    expect(controller.modules.value).toEqual(qrCode('https://hronaut.dev/'))
    expect(controller.tooLong.value).toBe(false)
  })

  it('copies and downloads the code of the text as edited, and names the download after the address it opened for', async () => {
    const { controller, api } = harness()
    controller.openFor({ tabId: 'tab-2', address: 'https://hronaut.dev/' })
    controller.text.value = 'https://hronaut.dev/guide'
    await controller.copy()
    expect(api.copyQrCode).toHaveBeenCalledExactlyOnceWith('https://hronaut.dev/guide')
    expect(controller.status.value).toBe('copied')
    await controller.download()
    expect(api.downloadQrCode).toHaveBeenCalledExactlyOnceWith({ tabId: 'tab-2', text: 'https://hronaut.dev/guide', address: 'https://hronaut.dev/' })
    expect(controller.status.value).toBe('downloaded')
  })

  it('draws no code for empty text or text longer than a code holds, and then copies nothing', async () => {
    const { controller, api } = harness()
    controller.openFor({ tabId: 'tab-1', address: 'https://hronaut.dev/' })
    controller.text.value = ''
    expect([controller.modules.value, controller.tooLong.value]).toEqual([undefined, false])
    controller.text.value = 'x'.repeat(2332)
    expect([controller.modules.value, controller.tooLong.value]).toEqual([undefined, true])
    await controller.copy()
    await controller.download()
    expect(api.copyQrCode).not.toHaveBeenCalled()
    expect(api.downloadQrCode).not.toHaveBeenCalled()
  })

  it('says why a copy failed, and an answer after the text changed or the dialog closed changes nothing', async () => {
    const { controller, api } = harness()
    controller.openFor({ tabId: 'tab-1', address: 'https://hronaut.dev/' })
    api.copyQrCode.mockRejectedValueOnce(new Error('clipboard busy'))
    await controller.copy()
    expect(controller.error.value).toBe('Failed: clipboard busy')
    controller.text.value = 'https://hronaut.dev/a'
    expect(controller.error.value).toBe('')

    const late = deferred()
    api.copyQrCode.mockReturnValueOnce(late.promise)
    const copying = controller.copy()
    expect(controller.busy.value).toBe('copy')
    controller.text.value = 'https://hronaut.dev/b'
    // The new text can be copied at once.
    expect(controller.busy.value).toBeNull()
    late.resolve()
    await copying
    expect(controller.status.value).toBeNull()

    const closing = deferred()
    api.downloadQrCode.mockReturnValueOnce(closing.promise)
    const downloading = controller.download()
    controller.close()
    closing.reject(new Error('tab gone'))
    await downloading
    expect([controller.open.value, controller.error.value, controller.status.value]).toEqual([false, '', null])
  })

  it('closes when the tab it opened for closes, as Chrome\'s does', async () => {
    const { controller, tabIds } = harness()
    controller.openFor({ tabId: 'tab-1', address: 'https://hronaut.dev/' })
    tabIds.value = ['tab-1']
    await nextTick()
    expect(controller.open.value).toBe(true)
    tabIds.value = ['tab-2']
    await nextTick()
    expect(controller.open.value).toBe(false)
  })
})

describe('the QR code dialog', () => {
  afterEach(() => { vi.restoreAllMocks() })

  async function openDialog() {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const state = harness()
    render(QrCodeDialog, {
      global: { plugins: [createHronautI18n('en-US')] },
      props: { controller: state.controller, formatNumber: (value: number) => value.toLocaleString('en-US'), reportLayout: vi.fn() }
    })
    state.controller.openFor({ tabId: 'tab-1', address: 'https://hronaut.dev/' })
    await flushPromises()
    return state
  }

  it('shows the code of the address, with the address in a field that has the focus', async () => {
    await openDialog()
    expect(screen.getByRole('dialog', { name: 'Scan QR Code' })).toBeTruthy()
    const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'URL' })
    expect(field.value).toBe('https://hronaut.dev/')
    await vi.waitFor(() => expect(document.activeElement).toBe(field))
    const image = screen.getByRole('img', { name: 'QR code' })
    expect(image.querySelector('path')!.getAttribute('d')).toBe(qrCodePath(qrCode('https://hronaut.dev/')!))
    // The quiet zone is drawn around the 25 modules.
    expect(image.getAttribute('viewBox')).toBe('-4 -4 33 33')
    expect(screen.getByText('To scan this code, you can use a QR scanner app on your phone, or some camera apps.')).toBeTruthy()
  })

  it('redraws the code as the address is edited, and says when it is too long', async () => {
    const { api } = await openDialog()
    const user = userEvent.setup()
    const field = screen.getByRole('textbox', { name: 'URL' })
    await user.type(field, 'guide')
    expect(screen.getByRole('img', { name: 'QR code' }).querySelector('path')!.getAttribute('d')).toBe(qrCodePath(qrCode('https://hronaut.dev/guide')!))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(api.copyQrCode).toHaveBeenCalledWith('https://hronaut.dev/guide')
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('QR code image copied'))

    await user.clear(field)
    await user.click(field)
    await user.paste('x'.repeat(2400))
    expect(screen.queryByRole('img', { name: 'QR code' })).toBeNull()
    expect(screen.getByText('Use 2,000 characters or fewer')).toBeTruthy()
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Copy' }).disabled).toBe(true)
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Download' }).disabled).toBe(true)
  })

  it('closes with its close button', async () => {
    const { controller } = await openDialog()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Close QR code' }))
    expect(controller.open.value).toBe(false)
  })
})
