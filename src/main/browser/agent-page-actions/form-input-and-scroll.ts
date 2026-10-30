import { fillFormScript, targetActionScript, targetExpression, type BrowserFormField } from '../page-scripts.js'
import { assertFormFieldWritten, assertNativeEditability, assertTypedTextAccepted } from '../input-targets/target-checks.js'
import { MULTI_SELECT_WORLD_ID, multiSelectScript, normalizeSelectValues } from '../semantic-multi-select.js'
import type { Browser } from '../browser.js'
import { withBackgroundAgentFocusGuard } from '../agent-input-scope/focus-isolation.js'
import { getTab } from '../browser-core.js'
import { withAgentInput } from '../agent-input-scope/agent-input-scope.js'
import { nativeInputAuthority } from '../native-input-authority/native-input-authority.js'
import { validateTarget } from '../input-targets/input-targets.js'

/** Types text into a control in the tab's page, submitting its form when asked. */
export async function type(browser: Browser, target: {
  tabId?: string
  ref?: string
  selector?: string
  text: string
  submit?: boolean
}): Promise<unknown> {
  validateTarget(target)
  const tab = getTab(browser, target.tabId)
  const result = await withAgentInput(browser, tab.webContents, () =>
    tab.webContents.executeJavaScript(targetActionScript('type', target, target.text, target.submit), true))
  assertNativeEditability(result)
  assertTypedTextAccepted(result)
  return result
}

/**
 * Selects one option of a control in the tab's page, or several by value in
 * an isolated world, rechecking the agent's input authority around that
 * dispatch; a multiple selection whose outcome became uncertain reports so
 * rather than throwing.
 */
export async function select(browser: Browser, target: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, validateSelect?: (validateContext: () => void) => void, retainSelection?: (authority: { validate: () => void; dispose: () => void }) => void, markSelectionSubmitted?: () => void): Promise<unknown> {
  validateTarget(target)
  if ((target.value !== undefined) === (target.values !== undefined)) throw new Error('Provide exactly one of value or values')
  const tab = getTab(browser, target.tabId)
  if (target.values === undefined) {
    const result = await withAgentInput(browser, tab.webContents, () =>
      tab.webContents.executeJavaScript(targetActionScript('select', target, target.value), true))
    assertNativeEditability(result)
    return result
  }
  const values = normalizeSelectValues(target.values)
  const authority = nativeInputAuthority(browser, tab, validateSelect)
  retainSelection?.(authority)
  let submitted = false
  try {
    authority.validate()
    return await withAgentInput(browser, tab.webContents, async () => {
      authority.validate()
      submitted = true
      markSelectionSubmitted?.()
      const result = await tab.webContents.executeJavaScriptInIsolatedWorld(MULTI_SELECT_WORLD_ID, [{ code: multiSelectScript(target, values) }], true)
      authority.validate()
      return result
    })
  } catch {
    return { ok: false, status: submitted ? 'OUTCOME_UNKNOWN' : 'REJECTED', effects: submitted ? 'possible' : 'none', retrySafe: false,
      reason: submitted ? 'Selection dispatch or publication became uncertain; inspect fresh state without automatic replay' : 'Selection authority changed before dispatch' }
  } finally { if (!retainSelection) authority.dispose() }
}

/** Fills up to fifty form fields in the tab's page. */
export async function fillForm(browser: Browser, tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
  if (!fields.length || fields.length > 50) throw new Error('Provide between 1 and 50 form fields')
  for (const field of fields) validateTarget(field)
  const webContents = getTab(browser, tabId).webContents
  const result = await withAgentInput(browser, webContents, () => webContents.executeJavaScript(fillFormScript(fields), true))
  assertNativeEditability(result)
  assertTypedTextAccepted(result)
  assertFormFieldWritten(result)
  return result
}

/** Scrolls a control in the tab's page, or the page itself, by the deltas given or one screenful down. */
export async function scroll(browser: Browser, options: {
  tabId?: string
  ref?: string
  selector?: string
  deltaX?: number
  deltaY?: number
}): Promise<unknown> {
  if (options.ref || options.selector) validateTarget(options)
  const tab = getTab(browser, options.tabId)
  const target = options.ref || options.selector ? targetExpression(options) : 'document.scrollingElement'
  const hasExplicitDelta = options.deltaX !== undefined || options.deltaY !== undefined
  const deltaX = Math.min(Math.max(options.deltaX ?? 0, -100_000), 100_000)
  const deltaY = Math.min(Math.max(options.deltaY ?? (hasExplicitDelta ? 0 : 600), -100_000), 100_000)
  return withBackgroundAgentFocusGuard(browser, () => tab.webContents.executeJavaScript(`(() => {
      const target = ${target};
      if (!target) throw new Error('Scroll target not found.');
      if (target === document.scrollingElement) window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      else target.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      return { x: target.scrollLeft ?? window.scrollX, y: target.scrollTop ?? window.scrollY };
    })()`, false))
}
