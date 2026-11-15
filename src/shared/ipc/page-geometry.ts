import type { EmulationFrameGeometry } from '../emulation-frame.js'
import type { PageCardGeometry } from '../page-card.js'
import type { SplitDividerGeometry, SplitDividerSession } from '../split-view.js'
import type { EventChannel, InvokeChannel } from './channel.js'

/** The divider between the two pages of a split view, and its drag gesture, for the main window's shell. */
export const SPLIT_DIVIDER_IPC = {
  /** Main window → main: where the divider is, or null when no split shows. */
  get: 'split-divider:get' as InvokeChannel<[], SplitDividerGeometry | null>,
  /** Main window → main: starts a drag of the divider shown at this revision; null when it has changed since. */
  begin: 'split-divider:begin' as InvokeChannel<[revision: number], SplitDividerSession | null>,
  /** Main window → main: previews the dragged divider at this ratio; null when the drag is no longer current. */
  update: 'split-divider:update' as InvokeChannel<[token: string, ratio: number], SplitDividerGeometry | null>,
  /** Main window → main: ends the drag, keeping this ratio or the last one previewed, or without commit putting it back; null when the drag is no longer current. */
  finish: 'split-divider:finish' as InvokeChannel<[token: string, commit: boolean, ratio?: number], SplitDividerGeometry | null>,
  /** Main window → main: sets the ratio of the divider shown at this revision; null when it has changed since. */
  setRatio: 'split-divider:set-ratio' as InvokeChannel<[revision: number, ratio: number], SplitDividerGeometry | null>,
  /** Main → main window: the divider moved, or null when no split shows. */
  changed: 'split-divider:changed' as EventChannel<[geometry: SplitDividerGeometry | null]>
} as const

/** The frames the main window's shell draws around pages that emulate a viewport smaller than their space. */
export const EMULATION_FRAME_IPC = {
  /** Main window → main: the frames to draw. */
  get: 'emulation-frame:get' as InvokeChannel<[], EmulationFrameGeometry[]>,
  /** Main → main window: the frames changed. */
  changed: 'emulation-frame:changed' as EventChannel<[frames: EmulationFrameGeometry[]]>
} as const

/** Where each page in view sits, for the cards the main window's shell draws around them. */
export const PAGE_CARD_IPC = {
  /** Main window → main: the cards to draw. */
  get: 'page-card:get' as InvokeChannel<[], PageCardGeometry[]>,
  /** Main → main window: the cards changed. */
  changed: 'page-card:changed' as EventChannel<[cards: PageCardGeometry[]]>
} as const
