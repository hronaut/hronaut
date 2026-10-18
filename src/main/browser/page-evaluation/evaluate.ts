import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type { BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { dialogAwareEvaluateScript, releaseEvaluationDialogsScript } from '../page-scripts.js'
import type { PageEvaluationAccess, PageEvaluationTab } from './page-evaluation-access.js'

/** How long an evaluation waits for its script, and the call's cancellation. */
export interface EvaluationDeadline {
  timeoutMs: number
  signal?: AbortSignal
}

/** An evaluation that stopped waiting for its script because its deadline passed or its call was cancelled. */
export class EvaluationStoppedError extends Error {
  readonly reason: 'SCRIPT_TIMEOUT' | 'CANCELLED'
  /** Whether the script reached the page; false when the evaluation stopped before sending it. */
  readonly sent: boolean

  constructor(reason: 'SCRIPT_TIMEOUT' | 'CANCELLED', sent: boolean, timeoutMs: number) {
    const stopped = reason === 'SCRIPT_TIMEOUT' ? `The script did not finish within ${timeoutMs} ms` : 'The call was cancelled before the script finished'
    const unsent = reason === 'SCRIPT_TIMEOUT' ? `The ${timeoutMs} ms deadline passed before the script was sent` : 'The call was cancelled before the script was sent'
    super(sent ? `${stopped}. It may still be running in the page, so its effects are unknown.` : `${unsent}; nothing ran.`)
    this.name = 'EvaluationStoppedError'
    this.reason = reason
    this.sent = sent
  }
}

/**
 * Runs a script in the tab's page and returns its value. A foreground page,
 * or one whose DevTools are open, evaluates it directly; otherwise it runs
 * through the debugger with the page's dialogs dismissed or accepted as asked.
 * Hronaut never takes focus for it. With a deadline it stops waiting once the
 * deadline passes or the call is cancelled, also while it waits for the
 * debugger, releasing the focus guard and the debugger. The page's script is
 * left to finish on its own, and its dialog handling ends at once.
 */
export async function evaluate<Tab extends PageEvaluationTab>(access: PageEvaluationAccess<Tab>, script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}, deadline?: EvaluationDeadline): Promise<unknown> {
  const webContents = access.getTab(tabId).webContents
  if (dialog.promptText !== undefined) throw new Error('Text prompts are supported by browser_click; Electron does not implement prompt() evaluation')
  const stop = deadline && stopSignal(deadline)
  let sent = false
  const stopped = (): EvaluationStoppedError | undefined => stop?.aborted && deadline
    ? new EvaluationStoppedError(stopReason(stop), sent, deadline.timeoutMs) : undefined
  const settle = <T>(pending: Promise<T>): Promise<T> => stop ? settleBeforeStop(pending, stop, stopped) : pending
  const unstopped = (): void => {
    const error = stopped()
    if (error) throw error
  }
  unstopped()
  // Preserve foreground native-dialog behavior, but never let a background
  // evaluation activate Hronaut. Unexpected background dialogs are dismissed
  // inside the page wrapper; explicit dialogAction still wins.
  if (dialog.dialogAction === undefined && access.isWindowFocused()) {
    sent = true
    return access.withBackgroundAgentFocusGuard(() => settle(webContents.executeJavaScript(script, true)))
  }
  // DevTools owns Chromium's debugger session. Keep direct evaluation
  // available there while the native non-focusable guard blocks activation.
  if (dialog.dialogAction === undefined && (
    access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()
  )) {
    sent = true
    return access.withBackgroundAgentFocusGuard(() => settle(webContents.executeJavaScript(script, true)))
  }
  const dialogAction = dialog.dialogAction ?? 'dismiss'
  const evaluationId = randomUUID()
  // The outer settle stops waiting for the debugger; the inner one frees it
  // for the next command while Chromium keeps waiting on the script's promise.
  return access.withBackgroundAgentFocusGuard(() => settle(access.withDebugger(webContents, async () => {
    unstopped()
    const contextId = await access.mainWorldContextId(webContents)
    unstopped()
    sent = true
    try {
      return await settle(access.evaluateWithAttachedDebugger(webContents, dialogAwareEvaluateScript(script, dialogAction, evaluationId), contextId))
    } catch (error) {
      if (error instanceof EvaluationStoppedError) releaseEvaluationDialogs(webContents, evaluationId, contextId)
      throw error
    }
  })))
}

function stopSignal(deadline: EvaluationDeadline): AbortSignal {
  const timeout = AbortSignal.timeout(deadline.timeoutMs)
  return deadline.signal ? AbortSignal.any([deadline.signal, timeout]) : timeout
}

function stopReason(stop: AbortSignal): 'SCRIPT_TIMEOUT' | 'CANCELLED' {
  return stop.reason instanceof DOMException && stop.reason.name === 'TimeoutError' ? 'SCRIPT_TIMEOUT' : 'CANCELLED'
}

/** The call's own outcome, or the stop error once the stop signal fires first. */
function settleBeforeStop<T>(pending: Promise<T>, stop: AbortSignal, stopped: () => Error | undefined): Promise<T> {
  // A call that settles after the stop has nobody waiting for its outcome.
  pending.catch(() => undefined)
  const early = stopped()
  if (early) return Promise.reject(early)
  return new Promise<T>((resolve, reject) => {
    const onStop = (): void => reject(stopped())
    stop.addEventListener('abort', onStop, { once: true })
    pending.then(resolve, reject).finally(() => stop.removeEventListener('abort', onStop))
  })
}

/**
 * Returns the page's own dialogs once nothing waits for the stopped script.
 * It is sent beside the debugger lease, which a page stuck in a script would
 * otherwise hold, and a failure leaves only what the page's next load clears.
 */
function releaseEvaluationDialogs(webContents: WebContents, evaluationId: string, contextId: number): void {
  if (webContents.isDestroyed()) return
  webContents.debugger.sendCommand('Runtime.evaluate', {
    expression: releaseEvaluationDialogsScript(evaluationId), contextId, returnByValue: true, silent: true
  }).catch(() => undefined)
}
