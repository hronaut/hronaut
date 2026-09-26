import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { usePageMetadata } from './usePageMetadata.js'
import type { BrowserPageMetadataReport, BrowserTabState } from '../../../../../shared/types.js'

function fixture(detached = false) {
  const activeTab = ref<BrowserTabState>({ id: 'tab-one', url: 'https://example.test', navigationGeneration: 0 } as BrowserTabState)
  const inspectPageMetadata = vi.fn<() => Promise<BrowserPageMetadataReport>>()
  const controller = usePageMetadata({ activeTab, browser: { inspectPageMetadata },
    closeTransientPanels: vi.fn(), keepsSeparatePanelOpen: () => detached })
  return { activeTab, inspectPageMetadata, controller }
}
function pending() {
  let resolve!: (value: BrowserPageMetadataReport) => void
  let reject!: (error: Error) => void
  const promise = new Promise<BrowserPageMetadataReport>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const report = { tabId: 'tab-one', title: 'Current report' } as BrowserPageMetadataReport

describe('metadata feature request lifetime', () => {
  it('keeps a report open across unrelated state broadcasts', async () => {
    const { activeTab, controller, inspectPageMetadata } = fixture()
    inspectPageMetadata.mockResolvedValue(report)
    try {
      await controller.runPageMetadata()
      activeTab.value = { ...activeTab.value, title: 'Updated title' }
      expect(controller.pageMetadataPanelOpen.value).toBe(true)
      expect(controller.pageMetadataReport.value).toEqual(report)
    } finally { controller.dispose() }
  })
  it('closing and reopening cannot publish an earlier response', async () => {
    const { controller, inspectPageMetadata } = fixture()
    const first = pending()
    inspectPageMetadata.mockReturnValueOnce(first.promise).mockResolvedValueOnce(report)
    try {
      const request = controller.runPageMetadata()
      controller.pageMetadataPanelOpen.value = false
      await controller.runPageMetadata()
      first.resolve({ ...report, title: 'Stale report' })
      await request
      expect(controller.pageMetadataReport.value?.title).toBe('Current report')
    } finally { controller.dispose() }
  })

  it.each(['close', 'tab', 'reload', 'dispose'] as const)('invalidates an outstanding response on %s', async (action) => {
    const { activeTab, controller, inspectPageMetadata } = fixture()
    const first = pending()
    inspectPageMetadata.mockReturnValue(first.promise)
    try {
      const request = controller.runPageMetadata()
      if (action === 'close') controller.pageMetadataPanelOpen.value = false
      if (action === 'tab') activeTab.value = { ...activeTab.value, id: 'tab-two' }
      if (action === 'reload') activeTab.value.navigationGeneration++
      if (action === 'dispose') controller.dispose()
      first.resolve(report)
      await request
      expect(controller.pageMetadataReport.value).toBeNull()
    } finally { controller.dispose() }
  })

  it('keeps a detached panel open but clears its previous document and ignores late errors', async () => {
    const { activeTab, controller, inspectPageMetadata } = fixture(true)
    const first = pending()
    inspectPageMetadata.mockReturnValue(first.promise)
    try {
      const request = controller.runPageMetadata()
      activeTab.value.navigationGeneration++
      first.reject(new Error('Stale failure'))
      await request
      expect(controller.pageMetadataPanelOpen.value).toBe(true)
      expect(controller.pageMetadataState.value).toBe('idle')
      expect(controller.pageMetadataError.value).toBe('')
    } finally { controller.dispose() }
  })
})
