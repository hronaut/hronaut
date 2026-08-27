import { ref, watch, type Ref } from 'vue'
import type { HronautApi, McpTabActivity } from '../../../shared/types.js'
import { disposeAll, registerDisposers } from './dispose-all.js'

type McpActivityApi = Pick<HronautApi, 'onMcpTabActivity'>

export interface McpActivityControllerOptions {
  api: McpActivityApi
  tabIds: Readonly<Ref<readonly string[]>>
  hydrated: Readonly<Ref<boolean>>
  lingerMs?: number
}

const DEFAULT_LINGER_MS = 900

export function useMcpActivityController(options: McpActivityControllerOptions) {
  const activityByTab = ref<Record<string, McpTabActivity>>({})
  const activeRequestsByTab = new Map<string, Map<string, McpTabActivity>>()
  const lingerTimers = new Map<string, number>()
  const lingerMs = options.lingerMs ?? DEFAULT_LINGER_MS
  let cleanupCallbacks: (() => void)[] = []
  let disposed = false

  function clearLinger(tabId: string): void {
    const timer = lingerTimers.get(tabId)
    if (timer !== undefined) window.clearTimeout(timer)
    lingerTimers.delete(tabId)
  }

  function removeTab(tabId: string): void {
    clearLinger(tabId)
    activeRequestsByTab.delete(tabId)
    if (!(tabId in activityByTab.value)) return
    const next = { ...activityByTab.value }
    delete next[tabId]
    activityByTab.value = next
  }

  function tabExists(tabId: string): boolean {
    return !options.hydrated.value || options.tabIds.value.includes(tabId)
  }

  function accept(activity: McpTabActivity): void {
    if (disposed || !tabExists(activity.tabId)) return
    const requests = activeRequestsByTab.get(activity.tabId) ?? new Map<string, McpTabActivity>()
    if (activity.phase === 'started') {
      requests.set(activity.activityId, activity)
      activeRequestsByTab.set(activity.tabId, requests)
      clearLinger(activity.tabId)
      activityByTab.value = { ...activityByTab.value, [activity.tabId]: activity }
      return
    }

    if (!requests.delete(activity.activityId)) return
    clearLinger(activity.tabId)
    if (requests.size > 0) {
      activeRequestsByTab.set(activity.tabId, requests)
      const latest = [...requests.values()].at(-1)
      if (latest) activityByTab.value = { ...activityByTab.value, [activity.tabId]: latest }
      return
    }

    activeRequestsByTab.delete(activity.tabId)
    const timer = window.setTimeout(() => {
      if (disposed || activeRequestsByTab.has(activity.tabId)) return
      const next = { ...activityByTab.value }
      delete next[activity.tabId]
      activityByTab.value = next
      lingerTimers.delete(activity.tabId)
    }, lingerMs)
    lingerTimers.set(activity.tabId, timer)
  }

  function finishDisposal(): void {
    for (const timer of lingerTimers.values()) window.clearTimeout(timer)
    lingerTimers.clear()
    activeRequestsByTab.clear()
    activityByTab.value = {}
  }

  cleanupCallbacks = registerDisposers([
    () => options.api.onMcpTabActivity(accept),
    () => watch(
      [options.hydrated, () => options.tabIds.value.join('\u0000')],
      ([hydrated]) => {
        if (disposed || !hydrated) return
        const validTabIds = new Set(options.tabIds.value)
        const trackedTabIds = new Set([
          ...Object.keys(activityByTab.value),
          ...activeRequestsByTab.keys(),
          ...lingerTimers.keys()
        ])
        for (const tabId of trackedTabIds) {
          if (!validTabIds.has(tabId)) removeTab(tabId)
        }
      },
      { immediate: true }
    )
  ], () => {
    disposed = true
    finishDisposal()
  })

  function dispose(): void {
    if (disposed) return
    disposed = true
    const callbacks = cleanupCallbacks
    cleanupCallbacks = []
    try {
      disposeAll(callbacks)
    } finally {
      finishDisposal()
    }
  }

  return { activityByTab, accept, dispose }
}

export type McpActivityController = ReturnType<typeof useMcpActivityController>
