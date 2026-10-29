import type { WebContents } from 'electron'
import type { Browser } from '../browser.js'

/**
 * Evaluates the expression in the page through its attached debugger, in the
 * given context or the page's default one, awaiting a promise and returning
 * the value. A page exception is thrown as an error. The handles the
 * evaluation allocated are released before it settles.
 */
export async function evaluateWithAttachedDebugger(
  webContents: WebContents,
  expression: string,
  contextId?: number
): Promise<unknown> {
  const response = await webContents.debugger.sendCommand('Runtime.evaluate', {
    expression,
    ...(contextId !== undefined ? { contextId } : {}),
    awaitPromise: true,
    allowUnsafeEvalBlockedByCSP: true,
    returnByValue: true,
    userGesture: true
  }) as {
    result?: { value?: unknown; unserializableValue?: string; objectId?: string }
    exceptionDetails?: { text?: string; exception?: { description?: string; objectId?: string } }
  }
  try {
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? 'Page script failed')
    }
    return response.result && Object.hasOwn(response.result, 'value')
      ? response.result.value
      : response.result?.unserializableValue
  } finally {
    await releaseDebuggerEvaluationObjects(webContents, response)
  }
}

/** Releases the result and exception handles a debugger evaluation allocated, ignoring failures. */
export async function releaseDebuggerEvaluationObjects(
  webContents: WebContents,
  response: {
    result?: { objectId?: string }
    exceptionDetails?: { exception?: { objectId?: string } }
  }
): Promise<void> {
  // Exceptions can allocate separate result and exception handles, even with
  // returnByValue enabled. Cleanup must not replace the operation's error.
  const objectIds = new Set([
    response.result?.objectId,
    response.exceptionDetails?.exception?.objectId
  ].filter((objectId): objectId is string => typeof objectId === 'string'))
  await Promise.allSettled([...objectIds].map(async (objectId) => {
    await webContents.debugger.sendCommand('Runtime.releaseObject', { objectId })
  }))
}

/** The id of the page's main world context in its top frame; it throws when the context is not known. */
export async function mainWorldContextId(browser: Browser, webContents: WebContents): Promise<number> {
  const frameTree = await webContents.debugger.sendCommand('Page.getFrameTree') as {
    frameTree?: { frame?: { id?: string } }
  }
  const frameId = frameTree.frameTree?.frame?.id
  const contextId = frameId ? browser.defaultExecutionContexts.get(webContents.id)?.get(frameId)?.id : undefined
  if (contextId === undefined) throw new Error('Could not locate the website JavaScript context for prompt handling')
  return contextId
}
