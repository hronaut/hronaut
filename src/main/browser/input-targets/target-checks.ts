import type { WebContents } from 'electron'
import type { BrowserTab } from '../browser-tab.js'
import { pageScriptsRunNow } from '../page-script-readiness.js'
import { PAGE_PINCHED } from '../page-zoom/pinch-zoom.js'

/**
 * Requires the point inside the page's visual viewport at default scale and
 * without an offset, checking validate once the layout metrics arrive.
 */
export async function assertRightClickViewport(webContents: WebContents, x: number, y: number, validate: () => void): Promise<void> {
  const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
    cssVisualViewport?: { clientWidth: number; clientHeight: number; scale: number; offsetX: number; offsetY: number }
  }
  validate()
  const viewport = metrics.cssVisualViewport
  if (!viewport || viewport.scale !== 1 || viewport.offsetX !== 0 || viewport.offsetY !== 0
    || !Number.isFinite(viewport.clientWidth) || !Number.isFinite(viewport.clientHeight)
    || x < 0 || y < 0 || x >= viewport.clientWidth || y >= viewport.clientHeight) {
    throw new Error('Right-click requires a point inside a default visible CSS viewport')
  }
}

/** Rejects a click on a target the page script found natively disabled. */
export function assertClickTargetEnabled(result: unknown): void {
  if (result && typeof result === 'object' && 'nativeDisabled' in result && result.nativeDisabled === true) {
    throw new Error('Target is natively disabled. Wait for the page to enable it, then inspect it again before clicking.')
  }
}

/** Rejects a form write to a target, or numbered form field, the page script found natively disabled or read-only. */
export function assertNativeEditability(result: unknown): void {
  if (!result || typeof result !== 'object' || !('nativeEditability' in result)) return
  if (result.nativeEditability !== 'disabled' && result.nativeEditability !== 'readonly') return
  const index = formFieldIndex(result)
  const filled = filledBefore(index)
  throw new Error(`${index ? `Form field ${index}` : 'Target'} is natively ${result.nativeEditability}; form write rejected${filled ? `.${filled}` : ''}`)
}

const TYPED_FORMATS: Readonly<Record<string, string>> = {
  number: 'a number such as 12 or 3.5',
  date: 'a date such as 2025-03-04',
  time: 'a time such as 13:45',
  'datetime-local': 'a date and time such as 2025-03-04T13:45',
  month: 'a month such as 2025-03',
  week: 'a week such as 2025-W10'
}

/**
 * Rejects text the page script left out of a target, or numbered form field, because a number, date or time field does
 * not take it in its format; the field kept its value.
 */
export function assertTypedTextAccepted(result: unknown): void {
  if (!result || typeof result !== 'object' || !('typedText' in result) || result.typedText !== 'not-accepted') return
  const index = formFieldIndex(result)
  const type = 'inputType' in result && typeof result.inputType === 'string' && Object.hasOwn(TYPED_FORMATS, result.inputType) ? result.inputType : undefined
  const format = type ? ` It takes ${TYPED_FORMATS[type]!}.` : ''
  throw new Error(`${index ? `Form field ${index}` : 'Target'} is a${type ? ` ${type}` : 'n'} input that does not take the text as typed, so nothing was typed.${format}${filledBefore(index)}`)
}

/** Rejects a form fill the page script stopped at a field it could not find, choose an option in or write. */
export function assertFormFieldWritten(result: unknown): void {
  if (!result || typeof result !== 'object' || !('formField' in result)) return
  const index = formFieldIndex(result)
  const field = `form field ${index ?? '?'}`
  if (result.formField === 'missing') {
    throw new Error(`Form field ${index ?? '?'} was not found. Take a fresh browser_snapshot and use its ref, or provide a CSS selector.${filledBefore(index)}`)
  }
  if (result.formField === 'option-not-found') {
    const option = 'option' in result && typeof result.option === 'string' ? `: ${result.option}` : ''
    throw new Error(`Select option not found for ${field}${option}.${filledBefore(index)}`)
  }
  throw new Error(`Form field ${index ?? '?'} is not editable.${filledBefore(index)}`)
}

function formFieldIndex(result: object): number | undefined {
  const index = 'fieldIndex' in result ? result.fieldIndex : undefined
  return typeof index === 'number' && Number.isInteger(index) && index >= 1 && index <= 50 ? index : undefined
}

// Fields before a rejected one are written already, with their input and change events, as a page may only enable a
// field once an earlier one is filled.
function filledBefore(index: number | undefined): string {
  if (!index || index === 1) return ''
  return index === 2 ? ' Form field 1 was already filled.' : ` Form fields 1–${index - 1} were already filled.`
}

/**
 * Whether the agent's native pointer input refuses a pinched page of this tab: not in a phone viewport the agent
 * emulates, which sets its own scale, can show its page panned at it, and keeps that scale when the zoom is reset.
 */
export function refusesPinchedPage(tab: Pick<BrowserTab, 'emulation'>): boolean {
  return tab.emulation.viewport?.mobile !== true
}

function pinchedPageError(action: 'click' | 'hover' | 'drag'): Error {
  return new Error(`${action[0]!.toUpperCase()}${action.slice(1)} with native input needs the page at its normal scale, and it is pinched larger. `
    + 'Reset it with browser_zoom (action reset), then try again.')
}

async function refusePinchedPage(webContents: WebContents, action: 'click' | 'hover' | 'drag'): Promise<void> {
  if (await webContents.executeJavaScript(PAGE_PINCHED, false) === true) throw pinchedPageError(action)
}

/**
 * Refuses native pointer input on a page a person pinched larger: Chromium sends it to the part of the page the pinch
 * shows, from its offset, so a point measured on the page would land somewhere else. A page going to another document,
 * or still reading its own, is not asked, as a script would wait for it and hold the input with it. A page no script
 * runs in, such as a page's source or a page whose renderer exited, is left to the input, which reports there what it
 * pressed and what it left behind. The input's own check before it is sent covers both.
 */
export async function assertPageAtNormalScale(webContents: WebContents, action: 'click' | 'hover' | 'drag'): Promise<void> {
  if (!pageScriptsRunNow(webContents)) return
  let pinched: unknown
  try {
    pinched = await webContents.executeJavaScript(PAGE_PINCHED, false)
  } catch {
    return
  }
  if (pinched === true) throw pinchedPageError(action)
}

/**
 * As assertPageAtNormalScale, from Chromium's visual viewport with the debugger already attached, right before the input
 * is sent: it waits for no document and finds a pinch made since the page was measured. Its scale is the pinch alone,
 * whatever the page zoom; a phone viewport emulated in Developer Tools has a scale of 1 or less while not pinched, though
 * its layout viewport can be wider than the part shown.
 */
export async function assertPageAtNormalScaleBeforeInput(webContents: WebContents, action: 'click' | 'hover' | 'drag'): Promise<void> {
  const metrics = await webContents.debugger.sendCommand('Page.getLayoutMetrics') as {
    cssVisualViewport?: { scale: number; offsetX: number; offsetY: number }
  } | undefined
  const visual = metrics?.cssVisualViewport
  if (visual && (visual.scale > 1.001 || Math.abs(visual.offsetX) > 0.01 || Math.abs(visual.offsetY) > 0.01)) {
    throw pinchedPageError(action)
  }
}

/**
 * Requires the coordinate point inside the page's visible viewport, with the page at its normal scale unless
 * `refusePinch` is false (see refusesPinchedPage).
 */
export async function assertPointInsideVisibleViewport(
  webContents: WebContents,
  point: { x: number; y: number },
  action: 'click' | 'hover' | 'drag',
  refusePinch = true
): Promise<void> {
  if (refusePinch) await refusePinchedPage(webContents, action)
  const viewport = await webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })', false) as {
    width: number
    height: number
  }
  if (point.x >= viewport.width || point.y >= viewport.height) {
    const actionLabel = `${action[0]!.toUpperCase()}${action.slice(1)}`
    throw new RangeError(
      `${actionLabel} coordinates must be inside the visible viewport (${viewport.width} x ${viewport.height})`
    )
  }
}
