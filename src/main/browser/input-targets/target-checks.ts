import type { WebContents } from 'electron'

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

/** Requires the coordinate point inside the page's visible viewport. */
export async function assertPointInsideVisibleViewport(
  webContents: WebContents,
  point: { x: number; y: number },
  action: 'click' | 'hover' | 'drag'
): Promise<void> {
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
