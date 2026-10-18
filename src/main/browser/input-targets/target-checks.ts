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
  const index = 'fieldIndex' in result ? result.fieldIndex : undefined
  const target = typeof index === 'number' && Number.isInteger(index) && index >= 1 && index <= 50
    ? `Form field ${index}` : 'Target'
  throw new Error(`${target} is natively ${result.nativeEditability}; form write rejected`)
}

/** Requires the coordinate point inside the page's visible viewport. */
export async function assertPointInsideVisibleViewport(
  webContents: WebContents,
  point: { x: number; y: number },
  action: 'click' | 'hover' | 'drag'
): Promise<void> {
  const viewport = await webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })', true) as {
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
