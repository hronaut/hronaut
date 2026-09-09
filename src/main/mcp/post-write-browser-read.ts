import { browserPostconditionScript, type BrowserPostcondition } from '../../shared/post-write-postcondition.js'
import { readContinuityMarker } from '../../shared/workspace-continuity-marker.js'

export type PostconditionReadResult = 'matches' | 'not-yet-visible' | 'context-changed' | 'unavailable'

/** The browser owner supplies an isolated-world evaluator and a validator
 * bound to the original workspace/tab/policy/human-control evidence. The read
 * has a two-second bound; an unavailable result must not trigger a write retry.
 */
export async function readBrowserPostcondition(options: {
  condition: BrowserPostcondition
  validateCurrent: () => void
  evaluate: (script: string) => Promise<unknown>
  signal?: AbortSignal
}): Promise<PostconditionReadResult> {
  const { condition, validateCurrent, evaluate, signal } = options
  validateCurrent()
  const script = browserPostconditionScript(condition)
  const result = await readContinuityMarker(() => {
    // Evaluator invocation runs in a microtask; recheck after that boundary.
    validateCurrent()
    return evaluate(script)
  }, signal)
  validateCurrent()
  if (signal?.aborted) return 'unavailable'
  return result === 'matches' || result === 'not-yet-visible' || result === 'context-changed' ? result : 'unavailable'
}
