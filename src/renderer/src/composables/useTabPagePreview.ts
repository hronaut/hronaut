import { computed, ref, watch, type Ref } from 'vue'
import type { BrowserTabOverviewPreview, BrowserTabState } from '../../../shared/types.js'

/** Full-document captures are explicit and independent from live viewport thumbnails. */
export function useTabPagePreview(options: {
  open: Readonly<Ref<boolean>>
  tabs: Readonly<Ref<BrowserTabState[]>>
  capture: (tabId: string) => Promise<BrowserTabOverviewPreview>
}) {
  const tabId = ref<string | null>(null)
  const tab = computed(() => options.tabs.value.find((candidate) => candidate.id === tabId.value))
  const preview = ref<BrowserTabOverviewPreview | null>(null)
  const status = ref<'idle' | 'loading' | 'ready' | 'error' | 'changed' | 'closed'>('idle')
  const fit = ref('page')
  const error = ref<unknown>(null)
  let request = 0

  function back(): void {
    request += 1
    tabId.value = null
    preview.value = null
    error.value = null
    status.value = 'idle'
  }

  async function refresh(): Promise<void> {
    const current = tab.value
    const token = ++request
    error.value = null
    preview.value = null
    if (!current) { status.value = 'closed'; return }
    if (current.loading || current.sleeping) { status.value = 'changed'; return }
    const navigation = current.navigationGeneration
    status.value = 'loading'
    try {
      const result = await options.capture(current.id)
      if (request !== token || !options.open.value) return
      if (tab.value?.id !== current.id || tab.value.navigationGeneration !== navigation) return
      if (result.tabId !== current.id || result.navigationGeneration !== navigation
        || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(result.dataUrl)
        || !Number.isSafeInteger(result.width) || result.width <= 0
        || !Number.isSafeInteger(result.height) || result.height <= 0) throw new Error('Invalid preview')
      preview.value = result
      status.value = 'ready'
    } catch (cause) {
      if (request === token && options.open.value) { error.value = cause; status.value = 'error' }
    }
  }

  async function show(selected: BrowserTabState): Promise<void> {
    tabId.value = selected.id
    fit.value = 'page'
    await refresh()
  }

  const stopTabs = watch(() => JSON.stringify([tab.value?.id, tab.value?.navigationGeneration, tab.value?.loading, tab.value?.sleeping]), () => {
    if (!tabId.value) return
    request += 1
    error.value = null
    preview.value = null
    status.value = tab.value ? 'changed' : 'closed'
  }, { flush: 'sync' })
  const stopOpen = watch(options.open, (value) => { if (!value) back() }, { flush: 'sync' })
  function dispose(): void { back(); stopTabs(); stopOpen() }
  return { tabId, tab, preview, status, error, fit, show, refresh, back, dispose }
}
