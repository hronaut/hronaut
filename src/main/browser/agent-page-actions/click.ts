import type { BrowserDialogHandlingOptions } from '../../../shared/types.js'
import { acquireNativeClickAdmission, NativeClickAdmissionError, nativeClickObserver, nativeClickProgress, type NativeClickProgress } from '../native-click-admission.js'
import { NativeInputCleanupError } from '../native-input-cleanup.js'
import {
  type AgentPointerIdentity,
  dialogAwareClickScript,
  dialogAwareCoordinateClickScript,
  targetActionScript,
  targetPointScript
} from '../page-scripts.js'
import type { OpenedTabObservation } from '../click-opened-tabs.js'
import type { Browser } from '../browser.js'
import { showAgentPointer } from '../agent-pointer/agent-pointer.js'
import { evaluateWithAttachedDebugger, mainWorldContextId } from '../debugger-evaluation/debugger-evaluation.js'
import { coordinatePointOrValidateTarget } from '../input-targets/input-targets.js'
import { assertClickTargetEnabled, assertPointInsideVisibleViewport, assertRightClickViewport } from '../input-targets/target-checks.js'
import { dispatchNativeClick } from '../native-click/native-click.js'
import { rightClickEnvironment } from '../native-click/right-click-environment.js'
import { assertRightClickPlatform } from '../owned-right-click.js'
import { withOptionalDialogHandling } from '../website-dialogs/website-dialogs.js'
import { getTab } from '../browser-core.js'
import type { BrowserTab } from '../browser-tab.js'
import { withDebugger } from '../debugger-lease/debugger-lease.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'

/** A key held for one native click; ControlOrMeta is Meta on macOS and Control elsewhere. */
export type BrowserClickModifier = 'Shift' | 'Control' | 'Meta' | 'ControlOrMeta'

/** What an agent's click names: a tab, a control by ref or selector or a point, and how to click it. */
export type BrowserClickTarget = {
  tabId?: string
  ref?: string
  selector?: string
  x?: number
  y?: number
  doubleClick?: boolean
  native?: boolean
  button?: 'left' | 'right'
  modifiers?: readonly BrowserClickModifier[]
} & BrowserDialogHandlingOptions

/**
 * An agent's click on a control or at a point in the tab's page, reporting the
 * tabs the page opened meanwhile that are still open in its workspace.
 */
export async function click(browser: Browser, target: BrowserClickTarget, validateClick?: (validateContext: () => void) => void, recordClickProgress?: (progress: NativeClickProgress) => void, retainClickAuthority?: (authority: { validate(): void; dispose(): void }) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  let observed: { tab: BrowserTab; observation: OpenedTabObservation } | undefined
  try {
    const result = await dispatchClick(browser, target, validateClick, recordClickProgress, retainClickAuthority, (tab) => {
      observed = { tab, observation: browser.observeOpenedTabs(tab) }
    }, agent)
    const current = observed
    observed = undefined
    const opened = current && browser.stopObservingOpenedTabs(current.tab, current.observation)
    return opened && result && typeof result === 'object' ? { ...result, tabsOpenedDuringClick: opened } : result
  } finally {
    if (observed) browser.stopObservingOpenedTabs(observed.tab, observed.observation)
  }
}

/**
 * Clicks at a point, or on a control by ref or selector: semantically in the
 * page, through native input for a double, native or right click, or with a
 * website dialog answered as asked. Every await rechecks the agent's input
 * authority, and a native click whose release or target cleanup was not
 * confirmed blocks further semantic clicks on that page.
 */
async function dispatchClick(browser: Browser, target: BrowserClickTarget, validateClick: ((validateContext: () => void) => void) | undefined, recordClickProgress: ((progress: NativeClickProgress) => void) | undefined, retainClickAuthority: ((authority: { validate(): void; dispose(): void }) => void) | undefined, observeTab: (tab: BrowserTab) => void, agent?: AgentPointerIdentity): Promise<unknown> {
  const rightClick = target.button === 'right'
  if (rightClick) {
    assertRightClickPlatform(process.platform)
    if (!target.tabId || !target.native || target.doubleClick || target.x !== undefined || target.y !== undefined
      || Boolean(target.ref) === Boolean(target.selector)) throw new Error('Right-click requires one native semantic click.')
  }
  const modifierBits = target.modifiers === undefined ? 0 : clickModifierBits(target, process.platform)
  const coordinatePoint = coordinatePointOrValidateTarget(target, 'click')
  const tab = getTab(browser, target.tabId)
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
  const authority = nativeInputAuthority(browser, tab, validateClick)
  let environment: { validate(): void; dispose(): void } | undefined
  const assertClickCurrent = (): void => { authority.validate(); environment?.validate() }
  let retained = false
  try {
    if (rightClick) { environment = rightClickEnvironment(browser, tab); assertClickCurrent() }
    if (coordinatePoint) {
      await assertPointInsideVisibleViewport(webContents, coordinatePoint, 'click')
      await showAgentPointer(browser, webContents, coordinatePoint, 'click', { agent })
      if (dialogAction !== undefined) {
        await withAgentInput(browser, webContents, () => withOptionalDialogHandling(browser, webContents, target, async () => {
          const contextId = await mainWorldContextId(browser, webContents)
          assertClickCurrent()
          await evaluateWithAttachedDebugger(
            webContents,
            dialogAwareCoordinateClickScript(coordinatePoint, dialogAction, target.promptText),
            contextId
          )
        }))
      } else {
        await withAgentInput(browser, webContents, () => withDebugger(
          browser,
          webContents,
          () => dispatchNativeClick(browser, webContents, coordinatePoint, target.doubleClick === true, assertClickCurrent, undefined, undefined, rightClick)
        ))
      }
      return { ok: true, ...coordinatePoint, ...(target.doubleClick ? { doubleClick: true } : {}) }
    }
    if (target.doubleClick || target.native) {
      const progress = nativeClickProgress()
      const publish = (): void => {
        if (progress.targetCleanup === 'unconfirmed' || progress.inputCleanupFailed) browser.unconfirmedSemanticClicks.add(webContents)
        recordClickProgress?.({ ...progress })
      }
      const observer = nativeClickObserver(progress, publish)
      publish()
      try {
        assertClickCurrent()
        if (browser.unconfirmedSemanticClicks.has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
        progress.preparationAttempted = true; publish()
        const result = await withAgentInput(browser, webContents, () => withDebugger(browser, webContents, async () => {
          if (browser.unconfirmedSemanticClicks.has(webContents)) throw new NativeClickAdmissionError('CLICK_STATE_UNCONFIRMED', { ...progress })
          const admission = await acquireNativeClickAdmission(webContents.debugger, target, assertClickCurrent, progress, publish)
          let failure: unknown
          try {
            assertClickCurrent()
            // Retain the original before any page-owned flag setter or scroll preparation.
            await webContents.executeJavaScript('window.__hronautAgentInputActive = true', false).catch(() => undefined)
            assertClickCurrent()
            let point = await webContents.executeJavaScript(targetPointScript(target), false) as { x: number; y: number; tag: string }
            await showAgentPointer(browser, webContents, point, 'click', { agent })
            assertClickCurrent()
            point = await webContents.executeJavaScript(targetPointScript(target, { rejectNativeDisabled: true }), false) as typeof point
            try { assertClickTargetEnabled(point) } catch (error) { throw new NativeClickAdmissionError('TARGET_DISABLED', { ...progress }, error) }
            if (environment && retainClickAuthority && !retained) {
              retainClickAuthority({ validate: assertClickCurrent, dispose: () => { environment?.dispose(); authority.dispose() } })
              retained = true
            }
            await dispatchNativeClick(browser, webContents, point, target.doubleClick === true, assertClickCurrent, rightClick ? async (x, y) => {
              await assertRightClickViewport(webContents, x, y, assertClickCurrent)
              await admission.sample(x, y)
            } : admission.sample, observer, rightClick, modifierBits)
            return { ok: true, tag: point.tag, ...(target.doubleClick ? { doubleClick: true } : {}),
              ...(target.native ? { native: true } : {}), ...(rightClick ? { button: 'right' } : {}),
              ...(target.modifiers ? { modifiers: [...target.modifiers] } : {}), admission: 'sampled', progress }
          } catch (error) { failure = error; throw error }
          finally {
            if (progress.downAttempted > progress.upAcknowledged
              || (rightClick && progress.downAttempted > progress.downAcknowledged)) browser.unconfirmedSemanticClicks.add(webContents)
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
    const pointerPoint = await webContents.executeJavaScript(targetPointScript(target), false)
      .catch(() => undefined) as { x: number; y: number } | undefined
    if (pointerPoint) await showAgentPointer(browser, webContents, pointerPoint, 'click', { agent })
    const result = await withAgentInput(browser, webContents, () => {
      if (dialogAction === undefined) {
        // Pointer rendering and input preparation await page work. Recheck
        // authority immediately before the semantic action, just as for native input.
        assertClickCurrent()
        return webContents.executeJavaScript(targetActionScript('click', target), true)
      }
      return withOptionalDialogHandling(browser, webContents, target, async () => {
        const contextId = await mainWorldContextId(browser, webContents)
        assertClickCurrent()
        return evaluateWithAttachedDebugger(
          webContents,
          dialogAwareClickScript(target, dialogAction, target.promptText),
          contextId
        )
      })
    })
    assertClickTargetEnabled(result)
    return result
  } finally {
    if (!retained) { environment?.dispose(); authority.dispose() }
  }
}

const CLICK_MODIFIER_BITS: Readonly<Record<Exclude<BrowserClickModifier, 'ControlOrMeta'>, number>> = { Control: 2, Meta: 4, Shift: 8 }

/**
 * The CDP mouse event modifier bits for a click's keys. Keys apply only to
 * one native left click on a ref or selector, each named once;
 * ControlOrMeta is Meta on macOS and Control elsewhere, and is not combined
 * with either. Control alone on macOS turns a left click into a context-menu
 * gesture, so it is rejected there.
 */
function clickModifierBits(target: BrowserClickTarget, platform: NodeJS.Platform): number {
  const modifiers = target.modifiers ?? []
  if (!modifiers.length || new Set(modifiers).size !== modifiers.length
    || modifiers.some(modifier => modifier !== 'ControlOrMeta' && !Object.hasOwn(CLICK_MODIFIER_BITS, modifier))
    || (modifiers.includes('ControlOrMeta') && (modifiers.includes('Control') || modifiers.includes('Meta')))
    || !target.native || target.doubleClick || target.button === 'right' || target.x !== undefined || target.y !== undefined
    || Boolean(target.ref) === Boolean(target.selector) || target.dialogAction !== undefined || target.promptText !== undefined) {
    throw new Error('Modifier clicks require one native left click on a ref or selector, with each of Shift, Control, Meta or ControlOrMeta named once and ControlOrMeta not combined with Control or Meta.')
  }
  if (platform === 'darwin' && modifiers.includes('Control')) {
    throw new Error('On macOS a Control click opens a context menu instead of clicking; use Meta or ControlOrMeta.')
  }
  return modifiers.reduce((bits, modifier) => bits
    | (modifier === 'ControlOrMeta' ? CLICK_MODIFIER_BITS[platform === 'darwin' ? 'Meta' : 'Control'] : CLICK_MODIFIER_BITS[modifier]), 0)
}
