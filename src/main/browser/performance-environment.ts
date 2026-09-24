import { createHash } from 'node:crypto'
import type { BrowserEmulationState } from '../../shared/types.js'
import { cloneEmulationState } from './emulation-state.js'

export function performanceEnvironmentFingerprint(
  state: BrowserEmulationState,
  headers: Record<string, string>,
  viewport: { width: number; height: number },
  zoomPercent: number
): string {
  const emulation = cloneEmulationState(state)
  if (emulation.extraHttpHeaderNames) emulation.extraHttpHeaderNames.sort()
  return createHash('sha256').update(JSON.stringify({
    emulation,
    extraHttpHeaders: headers,
    viewport: { width: viewport.width, height: viewport.height },
    zoomPercent
  }, (_key, value: unknown) => {
    // Settings insertion order does not change the browser environment.
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
    }
    return value
  })).digest('hex')
}
