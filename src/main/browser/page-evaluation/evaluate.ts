import type { BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { dialogAwareEvaluateScript } from '../page-scripts.js'
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
    const stopped = reason === 'SCRIPT_TIMEOUT' ? `did not finish within ${timeoutMs} ms` : 'was cancelled'
    super(sent
      ? `The script ${stopped}. It may still be running in the page, so its effects are unknown.`
      : `The evaluation ${stopped} before the script was sent; nothing ran.`)
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
 * deadline passes or the call is cancelled, releasing the focus guard and the
 * debugger, and leaves the page's script to finish on its own.
 */
export async function evaluate<Tab extends PageEvaluationTab>(access: PageEvaluationAccess<Tab>, script: string, tabId?: string, dialog: BrowserDialogHandlingOptions = {}, deadline?: EvaluationDeadline): Promise<unknown> {
  const webContents = access.getTab(tabId).webContents
  if (dialog.promptText !== undefined) throw new Error('Text prompts are supported by browser_click; Electron does not implement prompt() evaluation')
  const stop = deadline && stopSignal(deadline)
  const stopped = (sent: boolean): EvaluationStoppedError => new EvaluationStoppedError(stopReason(stop!), sent, deadline!.timeoutMs)
  if (stop?.aborted) throw stopped(false)
  const settle = <T>(pending: Promise<T>): Promise<T> => stop ? settleBeforeStop(pending, stop, () => stopped(true)) : pending
  // Preserve foreground native-dialog behavior, but never let a background
  // evaluation activate Hronaut. Unexpected background dialogs are dismissed
  // inside the page wrapper; explicit dialogAction still wins.
  if (dialog.dialogAction === undefined && access.isWindowFocused()) {
    return access.withBackgroundAgentFocusGuard(() => settle(webContents.executeJavaScript(script, true)))
  }
  // DevTools owns Chromium's debugger session. Keep direct evaluation
  // available there while the native non-focusable guard blocks activation.
  if (dialog.dialogAction === undefined && (
    access.isDevToolsOpening(webContents.id) || webContents.isDevToolsOpened()
  )) {
    return access.withBackgroundAgentFocusGuard(() => settle(webContents.executeJavaScript(script, true)))
  }
  const dialogAction = dialog.dialogAction ?? 'dismiss'
  return access.withBackgroundAgentFocusGuard(() => access.withDebugger(webContents, async () => {
    const contextId = await access.mainWorldContextId(webContents)
    if (stop?.aborted) throw stopped(false)
    // Settling inside the debugger lease frees it for the next command while
    // Chromium keeps waiting on the script's promise.
    return settle(access.evaluateWithAttachedDebugger(webContents, dialogAwareEvaluateScript(script, dialogAction), contextId))
  }))
}

function stopSignal(deadline: EvaluationDeadline): AbortSignal {
  const timeout = AbortSignal.timeout(deadline.timeoutMs)
  return deadline.signal ? AbortSignal.any([deadline.signal, timeout]) : timeout
}

function stopReason(stop: AbortSignal): 'SCRIPT_TIMEOUT' | 'CANCELLED' {
  return stop.reason instanceof DOMException && stop.reason.name === 'TimeoutError' ? 'SCRIPT_TIMEOUT' : 'CANCELLED'
}

/** The script's own outcome, or the stop error once the stop signal fires first. */
function settleBeforeStop<T>(pending: Promise<T>, stop: AbortSignal, stopped: () => Error): Promise<T> {
  // A script that settles after the stop has nobody waiting for its outcome.
  pending.catch(() => undefined)
  if (stop.aborted) return Promise.reject(stopped())
  return new Promise<T>((resolve, reject) => {
    const onStop = (): void => reject(stopped())
    stop.addEventListener('abort', onStop, { once: true })
    pending.then(resolve, reject).finally(() => stop.removeEventListener('abort', onStop))
  })
}
