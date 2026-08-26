import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePageExportController } from '../../src/renderer/src/composables/usePageExportController.js'
import type { BrowserPdfExport, BrowserSnapshotCopyResult, BrowserTabState } from '../../src/shared/types.js'

function tab(url = 'https://example.test/start'): BrowserTabState {
  return { id: 'tab-1', title: 'Example', url } as BrowserTabState
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<Value>((next, fail) => {
    resolve = next
    reject = fail
  })
  return { promise, resolve, reject }
}

function createController() {
  const activeTab = ref<BrowserTabState | undefined>(tab())
  const snapshotCopied = vi.fn()
  const snapshotFailed = vi.fn()
  const pdfSaved = vi.fn()
  const pdfFailed = vi.fn()
  const browser = {
    copySnapshot: vi.fn(async (): Promise<BrowserSnapshotCopyResult> => ({ copied: true, characters: 42, truncated: false })),
    savePdf: vi.fn(async (): Promise<BrowserPdfExport> => ({ filename: 'page.pdf', path: '/tmp/page.pdf', bytes: 42 }))
  }
  const controller = usePageExportController({
    activeTab,
    browser,
    snapshotCopied,
    snapshotFailed,
    pdfSaved,
    pdfFailed
  })
  return { activeTab, browser, controller, snapshotCopied, snapshotFailed, pdfSaved, pdfFailed }
}

describe('page export controller', () => {
  it('ignores a snapshot completion after the same tab navigates', async () => {
    const pending = deferred<BrowserSnapshotCopyResult>()
    const { activeTab, browser, controller, snapshotCopied } = createController()
    browser.copySnapshot.mockImplementationOnce(() => pending.promise)

    const copying = controller.copySnapshot()
    activeTab.value = tab('https://example.test/next')
    await nextTick()
    pending.resolve({ copied: true, characters: 99, truncated: false })
    await copying

    expect(controller.snapshotState.value).toBe('idle')
    expect(snapshotCopied).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('keeps a snapshot request alive for same-page tab metadata updates', async () => {
    const pending = deferred<BrowserSnapshotCopyResult>()
    const { activeTab, browser, controller, snapshotCopied } = createController()
    browser.copySnapshot.mockImplementationOnce(() => pending.promise)

    const copying = controller.copySnapshot()
    activeTab.value = { ...tab(), title: 'Updated title' }
    await nextTick()
    pending.resolve({ copied: true, characters: 99, truncated: false })
    await copying

    expect(controller.snapshotState.value).toBe('copied')
    expect(snapshotCopied).toHaveBeenCalledWith({ copied: true, characters: 99, truncated: false })
    controller.dispose()
  })

  it('invalidates an in-flight PDF export when the active tab changes', async () => {
    const pending = deferred<BrowserPdfExport>()
    const { activeTab, browser, controller, pdfSaved } = createController()
    browser.savePdf.mockImplementationOnce(() => pending.promise)

    const saving = controller.savePdf()
    activeTab.value = { ...tab(), id: 'tab-2' }
    await nextTick()
    pending.resolve({ filename: 'old.pdf', path: '/tmp/old.pdf', bytes: 42 })
    await saving

    expect(controller.pdfState.value).toBe('idle')
    expect(controller.pdfExport.value).toBeNull()
    expect(pdfSaved).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('reports PDF completion and failure only while the exporting page is current', async () => {
    const { browser, controller, pdfSaved, pdfFailed } = createController()
    const exported = { filename: 'page.pdf', path: '/tmp/page.pdf', bytes: 42 }

    await controller.savePdf()
    expect(pdfSaved).toHaveBeenCalledWith(exported)
    expect(pdfFailed).not.toHaveBeenCalled()

    const failure = new Error('Download directory is read-only')
    browser.savePdf.mockRejectedValueOnce(failure)
    await controller.savePdf()
    expect(controller.pdfState.value).toBe('error')
    expect(pdfFailed).toHaveBeenCalledWith(failure)
    controller.dispose()
  })

  it('does not report a stale PDF failure after the active tab changes', async () => {
    const pending = deferred<BrowserPdfExport>()
    const { activeTab, browser, controller, pdfFailed } = createController()
    browser.savePdf.mockImplementationOnce(() => pending.promise)

    const saving = controller.savePdf()
    activeTab.value = { ...tab(), id: 'tab-2' }
    await nextTick()
    pending.reject(new Error('Old tab export failed'))
    await saving

    expect(pdfFailed).not.toHaveBeenCalled()
    controller.dispose()
  })
})
