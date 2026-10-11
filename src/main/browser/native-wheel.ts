import { z } from 'zod'

/** One small gesture, in viewport CSS pixels; never a gesture sequence. */
export const nativeWheelFields = {
  x: z.number().finite().min(0).max(16384),
  y: z.number().finite().min(0).max(16384),
  deltaX: z.number().finite().min(-1000).max(1000),
  deltaY: z.number().finite().min(-1000).max(1000)
}

export const nativeWheelInput = z.object({ tabId: z.string().min(1), ...nativeWheelFields }).strict()
  .refine(input => input.deltaX !== 0 || input.deltaY !== 0, 'At least one wheel delta must be nonzero')

export type NativeWheelInput = z.infer<typeof nativeWheelInput>

/** A command was attempted; a failed acknowledgement does not prove no effects. */
export class NativeWheelOutcomeUnknownError extends Error {
  constructor(cause: unknown) {
    super('Wheel command outcome is unknown. Inspect fresh page state; do not replay automatically.', { cause })
    this.name = 'NativeWheelOutcomeUnknownError'
  }
}
