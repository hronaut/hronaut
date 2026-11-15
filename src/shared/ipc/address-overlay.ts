import type { AddressSuggestionOverlayRequest, AddressSuggestionOverlayState, AddressSuggestionSelection } from '../address-suggestions.js'
import type { EventChannel, SendChannel } from './channel.js'

/** The address field's suggestions, which main draws in their own view over the page, for the main window's shell. */
export const ADDRESS_OVERLAY_IPC = {
  /** Shell → main: shows the suggestions for the address field, or updates the ones shown. */
  show: 'address-overlay:show' as SendChannel<[request: AddressSuggestionOverlayRequest]>,
  /** Shell → main: hides the suggestions. */
  hide: 'address-overlay:hide' as SendChannel<[]>,
  /** Shell → main: gives the keyboard back to the address field after a middle-click on a suggestion took it. */
  returnFocus: 'address-overlay:return-focus' as SendChannel<[]>,
  /** Main → shell: the person chose a suggestion. */
  selected: 'address-overlay:selected' as EventChannel<[selection: AddressSuggestionSelection]>,
  /** Main → shell: the suggestions view of this session is gone; main ignores show until the shell hides them. */
  dismissed: 'address-overlay:dismissed' as EventChannel<[sessionId: number]>
} as const

/** The suggestions view's own channels; main takes them only from the current view. */
export const ADDRESS_OVERLAY_VIEW_IPC = {
  /** Main → view: the suggestions to draw. */
  state: 'address-overlay:state' as EventChannel<[state: AddressSuggestionOverlayState]>,
  /** View → main: the person chose a suggestion. */
  select: 'address-overlay:select' as SendChannel<[selection: AddressSuggestionSelection]>,
  /** View → main: the height the suggestions take, so main sizes the view to them. */
  measured: 'address-overlay:measured' as SendChannel<[height: number]>
} as const
