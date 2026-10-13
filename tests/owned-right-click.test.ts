import { describe, expect, it } from 'vitest'
import { assertRightClickPlatform, ownedRightClickPress } from '../src/main/browser/owned-right-click.js'
import { nativeClickObserver, nativeClickProgress } from '../src/main/browser/native-click-admission.js'
import type { NativeInputDispatchObserver } from '../src/main/browser/native-key-hold.js'

const down = { type: 'mousePressed', button: 'right', buttons: 2, x: 10, y: 20, clickCount: 1 }
const up = { ...down, type: 'mouseReleased', buttons: 0 }
const state = () => {
  const progress = nativeClickProgress()
  return { progress, observer: nativeClickObserver(progress, () => {}) }
}

describe('owned single right release', () => {
  it.each(['win32', 'darwin', 'freebsd'])('rejects unsupported platform %s explicitly', platform => {
    expect(() => assertRightClickPlatform(platform)).toThrow('only on Linux')
  })
  it('accepts only the natively probed Linux platform', () => expect(() => assertRightClickPlatform('linux')).not.toThrow())

  it('does not release when press preparation rejects before raw submission', async () => {
    let releases = 0
    const failure = new Error('authority changed')
    await expect(ownedRightClickPress(async () => { throw failure }, async () => { releases++ })).rejects.toBe(failure)
    expect(releases).toBe(0)
  })

  it.each(['press', 'release'] as const)('controlled source ordering: context-menu effect on %s remains possible after cancellation', async order => {
    // Controlled callbacks model event order. They are NOT native Windows/macOS
    // execution, nor DOM event synthesis, and make no isTrusted claim.
    const events: string[] = []
    const { progress, observer } = state()
    const failure = new Error('press acknowledgement lost')
    let cancelled = false
    await expect(ownedRightClickPress(async tracked => {
      tracked.rawAttempted(down); events.push('down')
      if (order === 'press') events.push('contextmenu')
      cancelled = true
      throw failure
    }, async tracked => {
      expect(cancelled).toBe(true)
      tracked.rawAttempted(up); events.push('up')
      if (order === 'release') events.push('contextmenu')
      tracked.rawAcknowledged(up)
    }, observer)).rejects.toBe(failure)
    expect(events).toEqual(order === 'press' ? ['down', 'contextmenu', 'up'] : ['down', 'up', 'contextmenu'])
    expect(progress).toMatchObject({ downAttempted: 1, downAcknowledged: 0, upAttempted: 1, upAcknowledged: 1 })
  })

  it.each(['preparation', 'raw-ack', 'relock'] as const)('reserves one outer release even when %s fails', async phase => {
    const { progress, observer } = state()
    const original = new Error('uncertain down')
    let releases = 0
    await expect(ownedRightClickPress(async tracked => { tracked.rawAttempted(down); throw original }, async tracked => {
      releases++
      if (phase === 'preparation') throw new Error('cannot prepare up')
      tracked.rawAttempted(up)
      if (phase === 'raw-ack') throw new Error('up may have executed')
      tracked.rawAcknowledged(up)
      throw new Error('cannot restore barrier')
    }, observer)).rejects.toBe(original)
    expect(releases).toBe(1)
    expect(progress).toMatchObject({ inputCleanupFailed: true, upAttempted: phase === 'preparation' ? 0 : 1, upAcknowledged: phase === 'relock' ? 1 : 0 })
  })

  it.each(['preparation', 'raw-ack', 'relock', 'success'] as const)('does not duplicate adapter emergency release after %s', async phase => {
    const { progress, observer } = state()
    let outerReleases = 0
    const failure = new Error('press relock failed')
    await expect(ownedRightClickPress(async tracked => {
      tracked.rawAttempted(down); tracked.rawAcknowledged(down)
      tracked.cleanupFailed?.()
      // Existing adapter reserves BEFORE any emergency-up preparation awaits.
      tracked.emergencyReleaseStarted()
      if (phase !== 'preparation') tracked.rawAttempted(up)
      if (phase === 'success' || phase === 'relock') tracked.rawAcknowledged(up)
      throw failure
    }, async () => { outerReleases++ }, observer)).rejects.toBe(failure)
    expect(outerReleases).toBe(0)
    expect(progress).toMatchObject({ downAttempted: 1, downAcknowledged: 1, upAttempted: phase === 'preparation' ? 0 : 1, upAcknowledged: phase === 'success' || phase === 'relock' ? 1 : 0 })
  })

  it.each(['before-up-ack', 'after-up-ack'] as const)('retains pending cleanup through %s with no timeout or replay', async phase => {
    let releaseBarrier!: () => void
    let notifyRelease!: () => void
    const barrier = new Promise<void>(resolve => { releaseBarrier = resolve })
    const started = new Promise<void>(resolve => { notifyRelease = resolve })
    const { progress, observer } = state()
    let settled = false
    const original = new Error('lost down ack')
    const pending = ownedRightClickPress(async tracked => { tracked.rawAttempted(down); throw original }, async tracked => {
      tracked.rawAttempted(up)
      if (phase === 'after-up-ack') tracked.rawAcknowledged(up)
      notifyRelease(); await barrier
      if (phase === 'before-up-ack') tracked.rawAcknowledged(up)
    }, observer).catch(error => { settled = true; return error })
    await started
    expect(settled).toBe(false)
    expect(progress.upAttempted).toBe(1)
    releaseBarrier()
    expect(await pending).toBe(original)
    expect(progress.upAcknowledged).toBe(1)
  })

  it('returns release failure when the press was acknowledged', async () => {
    const failure = new Error('release failed')
    await expect(ownedRightClickPress(async (tracked: NativeInputDispatchObserver) => {
      tracked.rawAttempted(down); tracked.rawAcknowledged(down)
    }, async () => { throw failure })).rejects.toBe(failure)
  })
})
