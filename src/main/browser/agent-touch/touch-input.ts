import { z } from 'zod'

// A touch gesture's input, apart from the gesture itself, so the MCP touch tool reads it without the gesture's Electron
// imports.

const coordinate = z.number().finite().min(0).max(16384)

/** One single-finger gesture in viewport CSS pixels: a tap at a point, or a straight swipe from it to an end point. */
export const nativeTouchFields = {
  gesture: z.enum(['tap', 'swipe']),
  x: coordinate,
  y: coordinate,
  endX: coordinate.optional(),
  endY: coordinate.optional(),
  durationMs: z.number().int().min(50).max(2000).optional()
}

/** A swipe names its end point and may name its duration; a tap names neither. */
export function refineNativeTouch(input: { gesture: 'tap' | 'swipe'; x: number; y: number; endX?: number; endY?: number; durationMs?: number }, context: z.RefinementCtx): void {
  if (input.gesture === 'tap') {
    if (input.endX !== undefined || input.endY !== undefined || input.durationMs !== undefined) {
      context.addIssue({ code: 'custom', message: 'A tap takes only x and y; endX, endY and durationMs are for a swipe' })
    }
    return
  }
  if (input.endX === undefined || input.endY === undefined) {
    context.addIssue({ code: 'custom', message: 'A swipe needs endX and endY' })
  } else if (input.endX === input.x && input.endY === input.y) {
    context.addIssue({ code: 'custom', message: 'A swipe must end at another point than it starts' })
  }
}

export const nativeTouchInput = z.object({ tabId: z.string().min(1), ...nativeTouchFields }).strict().superRefine(refineNativeTouch)

export type NativeTouchInput = z.infer<typeof nativeTouchInput>

/** How far a gesture got, from main-process bookkeeping only; never accepted from MCP arguments. */
export interface NativeTouchProgress {
  startAttempted: boolean
  movesAcknowledged: number
  endAcknowledged: boolean
  cancelAttempted: boolean
  cancelAcknowledged: boolean
  /**
   * Chromium no longer holds the contact although the page did not acknowledge
   * its end or cancel: Chromium took the cancel and then failed or is still
   * waiting for the page, held no contact any more, or its debugger session
   * ended or the page closed before a cancel could be sent.
   */
  contactCleared: boolean
}

/** A gesture before its first touch event. */
export const notStartedTouchProgress = (): NativeTouchProgress => ({
  startAttempted: false, movesAcknowledged: 0, endAcknowledged: false, cancelAttempted: false, cancelAcknowledged: false, contactCleared: false
})
