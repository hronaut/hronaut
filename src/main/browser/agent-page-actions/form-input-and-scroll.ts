import { fillFormScript, targetActionScript, targetExpression, type BrowserFormField } from '../page-scripts.js'
import { assertFormFieldWritten, assertTypedTextAccepted } from '../input-targets/target-checks.js'
import { MULTI_SELECT_WORLD_ID, multiSelectScript, normalizeSelectValues } from '../semantic-multi-select.js'
import type { AgentPageActionsAccess, AgentPageActionsTab } from './agent-page-actions-access.js'

/** Types text into a control in the tab's page, submitting its form when asked. */
export async function type<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, target: {
  tabId?: string
  ref?: string
  selector?: string
  text: string
  submit?: boolean
}): Promise<unknown> {
  access.validateTarget(target)
  const tab = access.getTab(target.tabId)
  const result = await access.withAgentInput(tab.webContents, () =>
    tab.webContents.executeJavaScript(targetActionScript('type', target, target.text, target.submit), true))
  access.assertNativeEditability(result)
  assertTypedTextAccepted(result)
  return result
}

/**
 * Selects one option of a control in the tab's page, or several by value in
 * an isolated world, rechecking the agent's input authority around that
 * dispatch; a multiple selection whose outcome became uncertain reports so
 * rather than throwing.
 */
export async function select<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, target: { tabId?: string; ref?: string; selector?: string; value?: string; values?: string[] }, validateSelect?: (validateContext: () => void) => void, retainSelection?: (authority: { validate: () => void; dispose: () => void }) => void, markSelectionSubmitted?: () => void): Promise<unknown> {
  access.validateTarget(target)
  if ((target.value !== undefined) === (target.values !== undefined)) throw new Error('Provide exactly one of value or values')
  const tab = access.getTab(target.tabId)
  if (target.values === undefined) {
    const result = await access.withAgentInput(tab.webContents, () =>
      tab.webContents.executeJavaScript(targetActionScript('select', target, target.value), true))
    access.assertNativeEditability(result)
    return result
  }
  const values = normalizeSelectValues(target.values)
  const authority = access.nativeInputAuthority(tab, validateSelect)
  retainSelection?.(authority)
  let submitted = false
  try {
    authority.validate()
    return await access.withAgentInput(tab.webContents, async () => {
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
export async function fillForm<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, tabId: string | undefined, fields: BrowserFormField[]): Promise<unknown> {
  if (!fields.length || fields.length > 50) throw new Error('Provide between 1 and 50 form fields')
  for (const field of fields) access.validateTarget(field)
  const webContents = access.getTab(tabId).webContents
  const result = await access.withAgentInput(webContents, () => webContents.executeJavaScript(fillFormScript(fields), true))
  access.assertNativeEditability(result)
  assertTypedTextAccepted(result)
  assertFormFieldWritten(result)
  return result
}

/** Scrolls a control in the tab's page, or the page itself, by the deltas given or one screenful down. */
export async function scroll<Tab extends AgentPageActionsTab>(access: AgentPageActionsAccess<Tab>, options: {
  tabId?: string
  ref?: string
  selector?: string
  deltaX?: number
  deltaY?: number
}): Promise<unknown> {
  if (options.ref || options.selector) access.validateTarget(options)
  const tab = access.getTab(options.tabId)
  const target = options.ref || options.selector ? targetExpression(options) : 'document.scrollingElement'
  const hasExplicitDelta = options.deltaX !== undefined || options.deltaY !== undefined
  const deltaX = Math.min(Math.max(options.deltaX ?? 0, -100_000), 100_000)
  const deltaY = Math.min(Math.max(options.deltaY ?? (hasExplicitDelta ? 0 : 600), -100_000), 100_000)
  return access.withBackgroundAgentFocusGuard(() => tab.webContents.executeJavaScript(`(() => {
      const target = ${target};
      if (!target) throw new Error('Scroll target not found.');
      if (target === document.scrollingElement) window.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      else target.scrollBy({ left: ${deltaX}, top: ${deltaY}, behavior: 'instant' });
      return { x: target.scrollLeft ?? window.scrollX, y: target.scrollTop ?? window.scrollY };
    })()`, false))
}
