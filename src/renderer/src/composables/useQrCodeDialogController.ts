import { computed, ref, watch, type Ref } from 'vue'
import { qrCode } from '../../../shared/qr-code.js'
import type { HronautApi } from '../../../shared/types.js'

export interface QrCodeDialogControllerOptions {
  api: Pick<HronautApi, 'copyQrCode' | 'downloadQrCode'>
  /** The open tabs; the dialog closes when the tab it was opened for does, as Chrome's closes with its tab. */
  tabIds: Readonly<Ref<readonly string[]>>
  /** Closes what the dialog would cover or fight for focus, such as the command palette or another dialog. */
  beforeOpen: () => void
  formatError: (error: unknown) => string
}

/**
 * Chrome's Create QR Code dialog: a QR code of the address of the page or image it was opened for, which the person can
 * edit, and Copy and Download for its image. The code is drawn as the text changes; text longer than a QR code holds
 * draws none. Copy and Download ask main, which makes the image itself, and an answer that comes after the dialog
 * closed or was opened again changes nothing.
 */
export function useQrCodeDialogController(options: QrCodeDialogControllerOptions) {
  const open = ref(false)
  const text = ref('')
  /** The tab and the address the dialog was opened for, which name the downloaded image. */
  const source = ref<{ tabId: string; address: string } | null>(null)
  const busy = ref<'copy' | 'download' | null>(null)
  const status = ref<'copied' | 'downloaded' | null>(null)
  const error = ref('')
  const modules = computed(() => (text.value ? qrCode(text.value) : undefined))
  const tooLong = computed(() => text.value !== '' && modules.value === undefined)
  let generation = 0

  function openFor(request: { tabId: string; address: string }): void {
    options.beforeOpen()
    generation++
    source.value = request
    text.value = request.address
    busy.value = null
    status.value = null
    error.value = ''
    open.value = true
  }

  function close(): void {
    if (!open.value) return
    generation++
    open.value = false
    busy.value = null
    source.value = null
  }

  async function run(action: 'copy' | 'download', request: () => Promise<void>): Promise<void> {
    if (!open.value || busy.value || !modules.value) return
    const current = ++generation
    busy.value = action
    status.value = null
    error.value = ''
    try {
      await request()
      if (current === generation) status.value = action === 'copy' ? 'copied' : 'downloaded'
    } catch (cause) {
      if (current === generation) error.value = options.formatError(cause)
    } finally {
      if (current === generation) busy.value = null
    }
  }

  const copy = (): Promise<void> => run('copy', () => options.api.copyQrCode(text.value))
  const download = (): Promise<void> => {
    const opened = source.value
    return opened ? run('download', () => options.api.downloadQrCode({ tabId: opened.tabId, text: text.value, address: opened.address })) : Promise.resolve()
  }

  // A new text has a new image, so what was said of the last one no longer holds, and an answer about it changes nothing.
  watch(text, () => {
    generation++
    busy.value = null
    status.value = null
    error.value = ''
  }, { flush: 'sync' })
  watch(options.tabIds, (tabIds) => {
    if (open.value && source.value && !tabIds.includes(source.value.tabId)) close()
  })

  return { open, text, modules, tooLong, busy, status, error, openFor, close, copy, download }
}

export type QrCodeDialogController = ReturnType<typeof useQrCodeDialogController>
