import { z } from 'zod'
import { NativeInputCleanupError } from './native-input-cleanup.js'
import { nativeKeyDescription } from './native-keyboard.js'
import { parseBrowserKeyPress } from '../../shared/keyboard-input.js'

const namedHoldKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'Enter', 'Tab',
  'Escape', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'
])

export const nativeKeyHoldFields = {
  key: z.string().max(16).refine(key => /^[a-z0-9]$/.test(key) || namedHoldKeys.has(key),
    'Use one lowercase letter, digit or supported named nonmodifier key'),
  durationMs: z.number().int().min(1).max(5000)
}
export const nativeKeyHoldInput = z.object({ tabId: z.string().min(1), ...nativeKeyHoldFields }).strict()
export type NativeKeyHoldInput = z.infer<typeof nativeKeyHoldInput>

/** Main-process provenance only; never accepted from MCP arguments. */
export interface NativeKeyHoldProgress {
  downAttempted: boolean
  downAcknowledged: boolean
  releaseStarted: boolean
  releaseAttempted: boolean
  releaseAcknowledged: boolean
}

export interface NativeInputDispatchObserver {
  rawAttempted: (params: Record<string, unknown>) => void
  rawAcknowledged: (params: Record<string, unknown>) => void
  emergencyReleaseStarted: () => void
  cleanupFailed?: () => void
}

export class NativeKeyHoldOutcomeUnknownError extends NativeInputCleanupError {
  constructor(cause: unknown, readonly progress: NativeKeyHoldProgress) {
    super(cause)
    this.name = 'NativeKeyHoldOutcomeUnknownError'
    this.message = 'Key hold outcome is unknown. Inspect fresh state; do not replay automatically.'
  }
}

export function nativeHeldKeyCommands(key: string): { down: Record<string, unknown>; up: Record<string, unknown> } {
  const description = nativeKeyDescription(parseBrowserKeyPress(key))
  const shared = { key: description.key, code: description.code, windowsVirtualKeyCode: description.virtualKeyCode, modifiers: 0 }
  return { down: { type: 'rawKeyDown', ...shared }, up: { type: 'keyUp', ...shared } }
}

/** Only the timed wait is cancellable; a pending CDP command has no deadline. */
export function waitForNativeKeyHold(deadline: number, validate: () => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let settled = false
    const finish = (failed = false, error?: unknown): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      if (failed) reject(error)
      else resolve()
    }
    const aborted = (): void => { finish(true, new Error('Key hold cancelled; earlier effects are not rolled back')) }
    const tick = (): void => {
      try {
        if (signal?.aborted) return aborted()
        validate()
        if (settled) return
        const remaining = deadline - performance.now()
        if (remaining <= 0) return finish()
        timer = setTimeout(tick, Math.min(20, remaining))
      } catch (error) { finish(true, error) }
    }
    signal?.addEventListener('abort', aborted, { once: true })
    tick()
  })
}
