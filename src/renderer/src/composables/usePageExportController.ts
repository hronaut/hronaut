import { ref, watch, type Ref } from 'vue'
import type {
  BrowserPdfExport,
  BrowserSnapshotCopyResult,
  BrowserTabState,
  HronautApi
} from '../../../shared/types.js'

type PageExportBrowserApi = Pick<HronautApi, 'copySnapshot' | 'savePdf'>

export interface PageExportControllerOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: PageExportBrowserApi
  snapshotCopied: (result: BrowserSnapshotCopyResult) => void
  snapshotFailed: (error: unknown) => void
  pdfSaved: (result: BrowserPdfExport) => void
  pdfFailed: (error: unknown) => void
}

interface PageRequest {
  tabId: string
  url: string
  generation: number
}

export function usePageExportController(options: PageExportControllerOptions) {
  const snapshotState = ref<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const pdfState = ref<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const pdfExport = ref<BrowserPdfExport | null>(null)
  let snapshotGeneration = 0
  let pdfGeneration = 0
  let snapshotResetTimer: number | undefined
  let pdfResetTimer: number | undefined

  function begin(kind: 'snapshot' | 'pdf'): PageRequest | null {
    const tab = options.activeTab.value
    if (!tab || tab.url.startsWith('hronaut://home')) return null
    return {
      tabId: tab.id,
      url: tab.url,
      generation: kind === 'snapshot' ? ++snapshotGeneration : ++pdfGeneration
    }
  }

  function current(kind: 'snapshot' | 'pdf', request: PageRequest): boolean {
    const tab = options.activeTab.value
    return request.generation === (kind === 'snapshot' ? snapshotGeneration : pdfGeneration)
      && tab?.id === request.tabId
      && tab.url === request.url
  }

  function reset(): void {
    snapshotGeneration += 1
    pdfGeneration += 1
    if (snapshotResetTimer !== undefined) window.clearTimeout(snapshotResetTimer)
    if (pdfResetTimer !== undefined) window.clearTimeout(pdfResetTimer)
    snapshotResetTimer = undefined
    pdfResetTimer = undefined
    snapshotState.value = 'idle'
    pdfState.value = 'idle'
    pdfExport.value = null
  }

  async function copySnapshot(): Promise<void> {
    if (snapshotState.value === 'copying') return
    const request = begin('snapshot')
    if (!request) return
    if (snapshotResetTimer !== undefined) window.clearTimeout(snapshotResetTimer)
    snapshotResetTimer = undefined
    snapshotState.value = 'copying'
    try {
      const result = await options.browser.copySnapshot(request.tabId)
      if (!current('snapshot', request)) return
      snapshotState.value = 'copied'
      options.snapshotCopied(result)
    } catch (error) {
      if (!current('snapshot', request)) return
      snapshotState.value = 'error'
      options.snapshotFailed(error)
    }
    snapshotResetTimer = window.setTimeout(() => {
      if (!current('snapshot', request)) return
      snapshotState.value = 'idle'
      snapshotResetTimer = undefined
    }, 1_800)
  }

  async function savePdf(): Promise<void> {
    if (pdfState.value === 'saving') return
    const request = begin('pdf')
    if (!request) return
    if (pdfResetTimer !== undefined) window.clearTimeout(pdfResetTimer)
    pdfResetTimer = undefined
    pdfState.value = 'saving'
    pdfExport.value = null
    try {
      const exported = await options.browser.savePdf({ tabId: request.tabId })
      if (!current('pdf', request)) return
      pdfExport.value = exported
      pdfState.value = 'saved'
      options.pdfSaved(exported)
    } catch (error) {
      if (!current('pdf', request)) return
      pdfState.value = 'error'
      options.pdfFailed(error)
    }
    pdfResetTimer = window.setTimeout(() => {
      if (!current('pdf', request)) return
      pdfState.value = 'idle'
      pdfExport.value = null
      pdfResetTimer = undefined
    }, 2_500)
  }

  const stopContextWatcher = watch(
    () => [options.activeTab.value?.id, options.activeTab.value?.url] as const,
    ([tabId, url], previousContext) => {
      if (previousContext && tabId === previousContext[0] && url === previousContext[1]) return
      reset()
    },
    { immediate: true }
  )

  function dispose(): void {
    stopContextWatcher()
    reset()
  }

  return { snapshotState, pdfState, pdfExport, copySnapshot, savePdf, reset, dispose }
}

export type PageExportController = ReturnType<typeof usePageExportController>
