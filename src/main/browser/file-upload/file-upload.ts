import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import { targetExpression } from '../page-scripts.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { releaseDebuggerEvaluationObjects } from '../debugger-evaluation/debugger-evaluation.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { validateTarget } from '../input-targets/input-targets.js'

/**
 * Sets the files of a file input on the tab's page through the debugger, as
 * agent input. Every path must be an absolute path to a file. It throws when
 * the page, the tab, its workspace's authority or its observation context
 * changed, and does not roll back an earlier effect.
 */
export async function uploadFiles(
  browser: Browser,
  target: { tabId?: string; ref?: string; selector?: string },
  paths: string[],
  validateUpload?: (validateContext: () => void) => void
): Promise<{ files: string[] }> {
  validateTarget(target)
  if (!paths.length || paths.length > 20) throw new Error('Provide between 1 and 20 file paths')
  const tab = getTab(browser, target.tabId)
  const webContents = tab.webContents
  const context = browser.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? browser.inspectionPermissions.get(workspace) ?? 0 : 0
  let documentCommitted = false
  const onCommitted = (): void => { documentCommitted = true }
  const assertContext = (): void => {
    const currentWorkspace = tab.mcpGroupId ? browser.mcpTabGroups.get(tab.mcpGroupId) : undefined
    if (documentCommitted || browser.destroyed || currentWorkspace !== workspace
      || (currentWorkspace ? browser.inspectionPermissions.get(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || findTab(browser, tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, browser.snapshotDeltaContext(tab))) {
      throw new Error('File upload context changed; earlier effects are not rolled back')
    }
  }
  const assertCurrent = (): void => { if (validateUpload) validateUpload(assertContext); else assertContext() }
  webContents.on('did-navigate', onCommitted)
  try {
    for (const path of paths) {
      if (!isAbsolute(path)) throw new Error(`File path must be absolute: ${path}`)
      const file = await stat(path)
      if (!file.isFile()) throw new Error(`Path is not a file: ${path}`)
    }
    assertCurrent()
    await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async () => {
      assertCurrent()
      const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: targetExpression(target),
        returnByValue: false,
        // The page gets the activation a person's click on the file input gives it.
        userGesture: true
      }) as {
        result?: { objectId?: string; subtype?: string }
        exceptionDetails?: { text?: string; exception?: { description?: string; objectId?: string } }
      }
      try {
        if (evaluated.exceptionDetails) {
          throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text ?? 'File input lookup failed')
        }
        const objectId = evaluated.result?.objectId
        if (!objectId || evaluated.result?.subtype === 'null') throw new Error('File input not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.')
        // No await between final authority/context validation and the file-input commit.
        assertCurrent()
        await webContents.debugger.sendCommand('DOM.setFileInputFiles', { files: paths, objectId })
      } finally {
        await releaseDebuggerEvaluationObjects(webContents, evaluated)
      }
    }))
    return { files: [...paths] }
  } finally {
    webContents.removeListener('did-navigate', onCommitted)
  }
}
