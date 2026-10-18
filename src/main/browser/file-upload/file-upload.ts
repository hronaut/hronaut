import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { snapshotDeltaInvalidationReason } from '../../../shared/snapshot-delta.js'
import { targetExpression } from '../page-scripts.js'
import type { FileUploadAccess, FileUploadTab } from './file-upload-access.js'

/**
 * Sets the files of a file input on the tab's page through the debugger, as
 * agent input. Every path must be an absolute path to a file. It throws when
 * the page, the tab, its workspace's authority or its observation context
 * changed, and does not roll back an earlier effect.
 */
export async function uploadFiles<Tab extends FileUploadTab>(
  access: FileUploadAccess<Tab>,
  target: { tabId?: string; ref?: string; selector?: string },
  paths: string[],
  validateUpload?: (validateContext: () => void) => void
): Promise<{ files: string[] }> {
  access.validateTarget(target)
  if (!paths.length || paths.length > 20) throw new Error('Provide between 1 and 20 file paths')
  const tab = access.getTab(target.tabId)
  const webContents = tab.webContents
  const context = access.snapshotDeltaContext(tab)
  const workspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
  const permissionGeneration = workspace ? access.inspectionPermission(workspace) ?? 0 : 0
  let documentCommitted = false
  const onCommitted = (): void => { documentCommitted = true }
  const assertContext = (): void => {
    const currentWorkspace = tab.mcpGroupId ? access.findWorkspace(tab.mcpGroupId) : undefined
    if (documentCommitted || access.isDestroyed() || currentWorkspace !== workspace
      || (currentWorkspace ? access.inspectionPermission(currentWorkspace) ?? 0 : 0) !== permissionGeneration
      || access.findTab(tab.id) !== tab || tab.webContents !== webContents || webContents.isDestroyed()
      || snapshotDeltaInvalidationReason(context, access.snapshotDeltaContext(tab))) {
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
    await access.withAgentInput(webContents, () => access.withDebugger(webContents, async () => {
      assertCurrent()
      const evaluated = await webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: targetExpression(target),
        returnByValue: false
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
        await access.releaseDebuggerEvaluationObjects(webContents, evaluated)
      }
    }))
    return { files: [...paths] }
  } finally {
    webContents.removeListener('did-navigate', onCommitted)
  }
}
