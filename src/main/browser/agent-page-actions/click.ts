import { NativeClickAdmissionError, nativeClickObserver, nativeClickProgress, type NativeClickProgress } from '../native-click-admission.js'
import { NativeInputCleanupError } from '../native-input-cleanup.js'
import {
  type AgentPointerIdentity,
  dialogAwareClickScript,
  dialogAwareCoordinateClickScript,
  targetActionScript,
  targetPointScript
} from '../page-scripts.js'
import type { OpenedTabObservation } from '../click-opened-tabs.js'
import type { AgentPageActionsAccess, AgentPageActionsTab, BrowserClickTarget } from './agent-page-actions-access.js'

/**
 * An agent's click on a control or at a point in the tab's page, reporting the
 * tabs the page opened meanwhile that are still open in its workspace.
 */
export async function click<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, target: BrowserClickTarget, validateClick?: (validateContext: () => void) => void, recordClickProgress?: (progress: NativeClickProgress) => void, retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  let observed: { tab: Tab; observation: OpenedTabObservation } | undefined
  try {
    const result = await dispatchClick(access, target, validateClick, recordClickProgress, retainClickAuthority, (tab) => {
      observed = { tab, observation: access.observeOpenedTabs(tab) }
    }, agent)
    const current = observed
    observed = undefined
    const opened = current && access.stopObservingOpenedTabs(current.tab, current.observation)
    return opened && result && typeof result === 'object' ? { ...result, tabsOpenedDuringClick: opened } : result
  } finally {
    if (observed) access.stopObservingOpenedTabs(observed.tab, observed.observation)
  }
}

/**
 * Clicks at a point, or on a control by ref or selector: semantically in the
 * page, through native input for a double, native or right click, or with a
 * website dialog answered as asked. Every await rechecks the agent's input
 * authority, and a native click whose release or target cleanup was not
 * confirmed blocks further semantic clicks on that page.
 */
async function dispatchClick<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, target: BrowserClickTarget, validateClick: ((validateContext: () => void) => void) | undefined, recordClickProgress: ((progress: NativeClickProgress) => void) | undefined, retainClickAuthority: ((authority: { validate(): void; dispose(): void }) => void) | undefined, observeTab: (tab: Tab) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const rightClick = target.button === 'right'
  if (rightClick) {
    access.assertRightClickPlatform(process.platform)
    if (!target.tabId || !target.native || target.doubleClick || target.x !== undefined || target.y !== undefined
      || Boolean(target.ref) === Boolean(target.selector)) throw new Error('Right-click requires one native semantic click.')
  }
  const coordinatePoint = access.coordinatePointOrValidateTarget(target, 'click')
  const tab = access.getTab(target.tabId)
  observeTab(tab)
  const webContents = tab.webContents
  const dialogAction = target.dialogAction
  if (target.promptText !== undefined && dialogAction !== 'accept') {
    throw new TypeError('promptText requires dialogAction: accept')
  }
  if (target.doubleClick && dialogAction !== undefined) {
    throw new TypeError('doubleClick cannot be combined with dialogAction or promptText')
  }
  if (target.native && dialogAction !== undefined) {
    throw new TypeError('native cannot be combined with dialogAction or promptText')
  }
  // A reload may already be pending when the click begins. Its commit does
  // not increment navigationGeneration again, but replaces the target document.
  const authority = access.nativeInputAuthority(tab, validateClick)
  let environment: { validate(): void; dispose(): void } | undefined
  const assertClickCurrent = (): void => { authority.validate(); environment?.validate() }
  let retained = false
  try {
    if (rightClick) { environment = access.rightClickEnvironment(tab); assertClickCurrent() }
    if (coordinatePoint) {
      await access.assertPointInsideVisibleViewport(webContents, coordinatePoint, 'click')
      await access.showAgentPointer(webContents, coordinatePoint, 'click', { agent })
      if (dialogAction !== undefined) {
        await access.withAgentInput(webContents, () => access.withOptionalDialogHandling(webContents, target, async () => {
          const contextId = await access.mainWorldContextId(webContents)
          assertClickCurrent()
          await access.evaluateWithAttachedDebugger(
            webContents,
            dialogAwareCoordinateClickScript(coordinatePoint, dialogAction, target.promptText),
            contextId
          )
        }))
      } else {
        await access.withAgentInput(webContents, () => access.withDebugger(
          webContents,
          () => access.dispatchNativeClick(webContents, coordinatePoint, target.doubleClick === true, assertClickCurrent, undefined, undefined, rightClick)
        ))
      }
      return { ok: true, ...coordinatePoint, ...(target.doubleClick ? { doubleClick: true } : {}) }
    }
    if (target.doubleClick || target.native) {
      const progress = nativeClickProgress()
      const publish = (): void => {
        if (progress.targetCleanup === 'unconfirmed' || progress.inputCleanupFailed) access.unconfirmedSemanticClicks().add(webContents)
        recordClickProgress?.({ ...progress })
      }
      const observer = nativeClickObserver(progress, publish)
      publish()
      try {
        assertClickCurrent()
        if (access.unconfirmedSemanticClicks().has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
        progress.preparationAttempted = true; publish()
        const result = await access.withAgentInput(webContents, () => access.withDebugger(webContents, async () => {
          if (access.unconfirmedSemanticClicks().has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
          const admission = await access.acquireNativeClickAdmission(webContents.debugger, target, assertClickCurrent, progress, publish)
          let failure: unknown
          try {
            assertClickCurrent()
            // Retain the original before any page-owned flag setter or scroll preparation.
            await webContents.executeJavaScript('window.__hronautAgentInputActive = true', true).catch(() => undefined)
            assertClickCurrent()
            let point = await webContents.executeJavaScript(targetPointScript(target), true) as { x: number; y: number; tag: string }
            await access.showAgentPointer(webContents, point, 'click', { agent })
            assertClickCurrent()
            point = await webContents.executeJavaScript(targetPointScript(target, { rejectNativeDisabled: true }), true) as typeof point
            try { access.assertClickTargetEnabled(point) } catch (error) { throw new NativeClickAdmissionError('TARGET_DISABLED', { ...progress }, error) }
            if (environment && retainClickAuthority && !retained) {
              retainClickAuthority({ validate: assertClickCurrent, dispose: () => { environment?.dispose(); authority.dispose() } })
              retained = true
            }
            await access.dispatchNativeClick(webContents, point, target.doubleClick === true, assertClickCurrent, rightClick ? async (x, y) => {
              await access.assertRightClickViewport(webContents, x, y, assertClickCurrent)
              await admission.sample(x, y)
            } : admission.sample, observer, rightClick)
            return { ok: true, tag: point.tag, ...(target.doubleClick ? { doubleClick: true } : {}),
              ...(target.native ? { native: true } : {}), ...(rightClick ? { button: 'right' } : {}), admission: 'sampled', progress }
          } catch (error) { failure = error; throw error }
          finally {
            if (progress.downAttempted > progress.upAcknowledged
              || (rightClick && progress.downAttempted > progress.downAcknowledged)) access.unconfirmedSemanticClicks().add(webContents)
            try { await admission.dispose() } catch (error) { if (!failure) throw error }
          }
        }, assertClickCurrent), { deferRendererFlag: true, onCleanupFailure: () => { progress.inputCleanupFailed = true; publish() } })
        if (progress.inputCleanupFailed) throw new NativeClickAdmissionError('NATIVE_INPUT_CLEANUP_FAILED', { ...progress })
        return result
      } catch (error) {
        throw new NativeClickAdmissionError(error instanceof NativeClickAdmissionError ? error.reason
          : error instanceof NativeInputCleanupError ? 'NATIVE_INPUT_CLEANUP_FAILED' : 'CONTEXT_OR_INPUT_UNCERTAIN', { ...progress }, error)
      }
    }
    const pointerPoint = await webContents.executeJavaScript(targetPointScript(target), true)
      .catch(() => undefined) as { x: number; y: number } | undefined
    if (pointerPoint) await access.showAgentPointer(webContents, pointerPoint, 'click', { agent })
    const result = await access.withAgentInput(webContents, () => {
      if (dialogAction === undefined) {
        // Pointer rendering and input preparation await page work. Recheck
        // authority immediately before the semantic action, just as for native input.
        assertClickCurrent()
        return webContents.executeJavaScript(targetActionScript('click', target), true)
      }
      return access.withOptionalDialogHandling(webContents, target, async () => {
        const contextId = await access.mainWorldContextId(webContents)
        assertClickCurrent()
        return access.evaluateWithAttachedDebugger(
          webContents,
          dialogAwareClickScript(target, dialogAction, target.promptText),
          contextId
        )
      })
    })
    access.assertClickTargetEnabled(result)
    return result
  } finally {
    if (!retained) { environment?.dispose(); authority.dispose() }
  }
}
