import { fileSourceAcquisitionPool, AcquisitionFailure } from '../../file-source-acquisition.js'
import { fileEvaluationFailure, type FileEvaluationSource, type FileEvaluationHooks, type FileEvaluationProgress } from '../../../shared/file-evaluation.js'
import { withBackgroundAgentFocusGuard } from '../agent-input-scope/focus-isolation.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { releaseDebuggerEvaluationObjects } from '../debugger-evaluation/debugger-evaluation.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { tabBelongsToMcpGroup } from '../workspace-scope/workspace-scope.js'

// Process-wide admission survives client and manager reconnects.
let activeFileEvaluations = 0

/**
 * Runs a verified script file in the main frame's default execution context
 * of a workspace tab, at most two at a time across the process. Every
 * authority, document, frame and origin check runs again right before the
 * script is submitted, with no await in between. It resolves with a status
 * rather than throwing, and the caller's deadline or cancellation wins.
 */
export async function evaluateFile(browser: Browser, source: FileEvaluationSource, hooks: FileEvaluationHooks): Promise<Record<string, unknown>> {
  const progress: FileEvaluationProgress = { submitted: false, acknowledged: false }
  if (activeFileEvaluations >= 2) return fileEvaluationFailure(progress, 'BUSY')
  activeFileEvaluations++
  const controller = new AbortController()
  const signal = hooks.signal ? AbortSignal.any([hooks.signal, controller.signal]) : controller.signal
  const timer = setTimeout(() => controller.abort(), 30_000)
  let dispose = (): void => undefined
  let retained = false
  const work = async (): Promise<Record<string, unknown>> => {
    const tab = getTab(browser, source.tabId)
    const contents = tab.webContents
    const generation = tab.navigationGeneration
    const mainFrame = contents.mainFrame
    const frameId = tab.mainFrameId
    let documentCommitted = false
    const onCommitted = (): void => { documentCommitted = true }
    dispose = () => { contents.removeListener('did-navigate', onCommitted) }
    const validate = (): void => {
      hooks.validate()
      if (documentCommitted || signal.aborted || browser.destroyed || contents.isDestroyed()
        || findTab(browser, source.tabId) !== tab || tab.navigationGeneration !== generation
        || contents.mainFrame !== mainFrame || tab.mainFrameId !== frameId
        || !tabBelongsToMcpGroup(browser, source.workspaceId, source.tabId)
        || new URL(contents.getURL()).origin !== source.expectedOrigin) throw new Error('File evaluation target unavailable')
    }
    // A WebFrameMain object and navigation-start generation can both survive
    // a navigation which started before admission and commits during acquisition.
    contents.on('did-navigate', onCommitted)
    hooks.retainPublication({ validate, dispose })
    retained = true
    validate()
    const script = await fileSourceAcquisitionPool.acquire(source.path, source.sha256, signal, 1000, validate)
    validate()
    return withBackgroundAgentFocusGuard(browser, () => withDebugger(browser, contents, async () => {
      validate()
      const tree = await contents.debugger.sendCommand('Page.getFrameTree') as { frameTree?: { frame?: { id?: string } } }
      validate()
      const currentFrame = tree.frameTree?.frame?.id
      const context = currentFrame ? browser.defaultExecutionContexts.get(contents.id)?.get(currentFrame) : undefined
      if (!frameId || currentFrame !== frameId || !context?.uniqueId) throw new Error('Unique context unavailable')
      validate()
      // No await between the complete main-owned authority check and submission.
      progress.submitted = true
      hooks.submitted()
      const response = await contents.debugger.sendCommand('Runtime.evaluate', {
        expression: script, uniqueContextId: context.uniqueId, awaitPromise: true,
        returnByValue: true, userGesture: true, silent: true, timeout: 10_000
      }) as { result?: { value?: unknown; unserializableValue?: string; objectId?: string }; exceptionDetails?: { exception?: { objectId?: string } } }
      progress.acknowledged = true
      try {
        validate()
        if (response.exceptionDetails) return fileEvaluationFailure(progress, 'SCRIPT_FAILED')
        return { status: 'RETURNED', submitted: true, acknowledged: true, retrySafe: false,
          value: response.result && Object.hasOwn(response.result, 'value') ? response.result.value : response.result?.unserializableValue }
      } finally { await releaseDebuggerEvaluationObjects(contents, response) }
    }, validate))
  }
  let abort!: () => void
  const cancelled = new Promise<Record<string, unknown>>(resolve => {
    abort = () => resolve(fileEvaluationFailure(progress, 'CANCELLED_OR_DEADLINE'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
  const running = work().catch(error => fileEvaluationFailure(progress,
    error instanceof AcquisitionFailure ? error.code : 'UNAVAILABLE')).finally(() => { activeFileEvaluations--; if (!retained) dispose() })
  hooks.retainCompletion(running.then(() => undefined))
  // The debugger queue retains running native work after caller cancellation.
  try { return await Promise.race([running, cancelled]) } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}
