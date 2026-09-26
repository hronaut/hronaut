import { ref, watch, type Ref } from 'vue'
import { isHronautHomeUrl } from '../../../../../shared/home-url.js'
import type { BrowserPageMetadataReport, BrowserTabState, HronautApi } from '../../../../../shared/types.js'

interface PageMetadataOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'inspectPageMetadata'>
  closeTransientPanels: () => void
  keepsSeparatePanelOpen: () => boolean
}

/** The same request lifetime is used by docked and detached metadata panels. */
export function usePageMetadata(options: PageMetadataOptions) {
  const pageMetadataPanelOpen = ref(false)
  const pageMetadataReport = ref<BrowserPageMetadataReport | null>(null)
  const pageMetadataState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const pageMetadataError = ref('')
  let sequence = 0
  let disposed = false

  function resetForContext(): void {
    sequence++
    if (!options.keepsSeparatePanelOpen()) pageMetadataPanelOpen.value = false
    pageMetadataReport.value = null
    pageMetadataState.value = 'idle'
    pageMetadataError.value = ''
  }

  async function runPageMetadata(): Promise<void> {
    const tab = options.activeTab.value
    if (disposed || !tab || isHronautHomeUrl(tab.url)) return
    const context = { id: tab.id, url: tab.url, navigationGeneration: tab.navigationGeneration }
    options.closeTransientPanels()
    pageMetadataPanelOpen.value = true
    const request = ++sequence
    const current = (): boolean => !disposed && request === sequence && pageMetadataPanelOpen.value
      && options.activeTab.value?.id === context.id && options.activeTab.value.url === context.url
      && options.activeTab.value.navigationGeneration === context.navigationGeneration
    pageMetadataState.value = 'loading'
    pageMetadataError.value = ''
    try {
      const report = await options.browser.inspectPageMetadata(context.id)
      if (!current()) return
      pageMetadataReport.value = report
      pageMetadataState.value = 'ready'
    } catch (cause) {
      if (!current()) return
      pageMetadataState.value = 'error'
      pageMetadataError.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function togglePageMetadata(): void {
    if (pageMetadataPanelOpen.value) pageMetadataPanelOpen.value = false
    else void runPageMetadata()
  }

  const stopContext = watch(
    [() => options.activeTab.value?.id, () => options.activeTab.value?.url, () => options.activeTab.value?.navigationGeneration],
    resetForContext,
    { flush: 'sync' }
  )
  const stopOpen = watch(pageMetadataPanelOpen, (open) => {
    if (!open) {
      sequence++
      if (pageMetadataState.value === 'loading') pageMetadataState.value = 'idle'
    }
  }, { flush: 'sync' })

  function dispose(): void {
    disposed = true
    sequence++
    stopContext()
    stopOpen()
  }

  return { pageMetadataPanelOpen, pageMetadataReport, pageMetadataState, pageMetadataError,
    runPageMetadata, togglePageMetadata, resetForContext, dispose }
}

export type PageMetadataController = ReturnType<typeof usePageMetadata>
