import { ref, watch, type Ref } from 'vue'
import type { BrowserReproCheckpointInput } from '../../../../../shared/repro-checkpoint.js'
import { formatReproAsPlaywright } from '../../../../../shared/repro-export.js'
import type { BrowserReproRecording, BrowserTabState, HronautApi } from '../../../../../shared/types.js'
import type { DiagnosticsCopyFeedback, DiagnosticsRecorderRequests } from '../diagnostics-request.js'

interface ReproRecorderOptions {
  activeTab: Readonly<Ref<BrowserTabState | undefined>>
  browser: Pick<HronautApi, 'manageRepro'>
  closeTransientPanels: () => void
}

/** The repro recorder panel, with its JSON and Playwright copies. */
export function useReproRecorder(
  options: ReproRecorderOptions,
  { beginRecorderRequest, finishRecorderRequest, current, copyWithFeedback }: DiagnosticsRecorderRequests<'repro'>
    & DiagnosticsCopyFeedback<'repro' | 'repro-playwright'>
) {
  const reproPanelOpen = ref(false)
  const reproRecording = ref<BrowserReproRecording | null>(null)
  const reproState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const reproError = ref('')
  const reproCopied = ref(false)
  const reproPlaywrightCopied = ref(false)

  async function manageRepro(action: 'start' | 'get' | 'stop' | 'clear' | 'checkpoint', checkpoint?: BrowserReproCheckpointInput): Promise<void> {
    const request = beginRecorderRequest('repro', action)
    if (!request) return
    reproState.value = 'loading'
    reproError.value = ''
    if (action !== 'get') {
      reproCopied.value = false
      reproPlaywrightCopied.value = false
    }
    try {
      const recording = await (checkpoint
        ? options.browser.manageRepro(action, request.tab.id, checkpoint)
        : options.browser.manageRepro(action, request.tab.id))
      if (!current('repro', request)) return
      reproRecording.value = recording
      reproState.value = 'ready'
    } catch (cause) {
      if (!current('repro', request)) return
      reproState.value = 'error'
      reproError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      finishRecorderRequest('repro', request)
    }
  }

  function toggleReproRecorder(): void {
    if (reproPanelOpen.value) {
      reproPanelOpen.value = false
      return
    }
    options.closeTransientPanels()
    reproPanelOpen.value = true
    void manageRepro('get')
  }

  const startReproRecording = (): Promise<void> => manageRepro('start')
  const stopReproRecording = (): Promise<void> => manageRepro('stop')
  const clearReproRecording = (): Promise<void> => manageRepro('clear')

  async function copyReproRecording(): Promise<void> {
    if (!reproRecording.value) return
    await copyWithFeedback('repro', JSON.stringify(reproRecording.value, null, 2), reproCopied)
  }

  async function copyReproPlaywright(): Promise<void> {
    if (!reproRecording.value) return
    await copyWithFeedback('repro-playwright', formatReproAsPlaywright(reproRecording.value), reproPlaywrightCopied)
  }

  /** The controller registers this after its page-context watcher, so a context reset runs first. */
  function watchReproRecording(): () => void {
    return watch(
      () => [options.activeTab.value?.id, options.activeTab.value?.reproRecording?.active, options.activeTab.value?.reproRecording?.stepCount] as const,
      ([tabId]) => {
        if (tabId && reproPanelOpen.value) void manageRepro('get')
      }
    )
  }

  return {
    reproPanelOpen,
    reproRecording,
    reproState,
    reproError,
    reproCopied,
    reproPlaywrightCopied,
    manageRepro,
    toggleReproRecorder,
    startReproRecording,
    stopReproRecording,
    clearReproRecording,
    copyReproRecording,
    copyReproPlaywright,
    watchReproRecording
  }
}
