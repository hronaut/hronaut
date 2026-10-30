import type { StatusBubbleMeasurement, StatusBubbleState } from '../status-bubble.js'
import type { EventChannel, SendChannel } from './channel.js'

/** The status bubble's view at a page's corner, which shows the address of the link the person points at or focuses. */
export const STATUS_BUBBLE_VIEW_IPC = {
  /** Main → view: the bubble to draw. */
  state: 'status-bubble:state' as EventChannel<[state: StatusBubbleState]>,
  /** View → main: the bubble's laid-out size, for the same id. */
  measured: 'status-bubble:measured' as SendChannel<[measurement: StatusBubbleMeasurement]>
} as const
