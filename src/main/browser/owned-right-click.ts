import type { NativeInputDispatchObserver } from './native-key-hold.js'

export function assertRightClickProbePlatform(platform: string): void {
  if (platform !== 'linux') throw new Error('Native right-click feasibility is supported only on Linux.')
}

/** Diagnostic only. A rejection is not proof that a raw press did not execute.
 * Reserve one release before any of its preparation awaits; the adapter's
 * emergency release consumes the same reservation. No timer abandons ownership. */
export async function ownedRightClickPress(
  press: (observer: NativeInputDispatchObserver) => Promise<unknown>,
  release: (observer: NativeInputDispatchObserver) => Promise<unknown>,
  observer?: NativeInputDispatchObserver
): Promise<void> {
  let possiblePress = false
  let releaseReserved = false
  let failed = false
  let failure: unknown
  const reserveRelease = (): boolean => {
    if (releaseReserved) return false
    releaseReserved = true
    return true
  }
  const tracked: NativeInputDispatchObserver = {
    rawAttempted(params) {
      if (params.type === 'mousePressed') possiblePress = true
      if (params.type === 'mouseReleased') reserveRelease()
      observer?.rawAttempted(params)
    },
    rawAcknowledged: params => observer?.rawAcknowledged(params),
    emergencyReleaseStarted() {
      reserveRelease()
      observer?.emergencyReleaseStarted()
    },
    cleanupFailed: () => observer?.cleanupFailed?.()
  }
  try { await press(tracked) } catch (error) { failed = true; failure = error }
  if (possiblePress && reserveRelease()) {
    try { await release(tracked) }
    catch (error) {
      tracked.cleanupFailed?.()
      if (!failed) { failed = true; failure = error }
    }
  }
  if (failed) throw failure
}
