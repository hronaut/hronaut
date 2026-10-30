import { contextBridge } from 'electron'
import type { AddressSuggestionOverlayState, AddressSuggestionSelection } from '../shared/address-suggestions.js'
import { ADDRESS_OVERLAY_VIEW_IPC } from '../shared/ipc/address-overlay.js'
import { send, subscribe } from './bridges/ipc.js'

export interface HronautAddressOverlayViewApi {
  onState(listener: (state: AddressSuggestionOverlayState) => void): () => void
  select(selection: AddressSuggestionSelection): void
  measured(height: number): void
}

const api: HronautAddressOverlayViewApi = {
  onState: (listener) => subscribe(ADDRESS_OVERLAY_VIEW_IPC.state, (state) => listener(state)),
  select: (selection) => send(ADDRESS_OVERLAY_VIEW_IPC.select, selection),
  measured: (height) => send(ADDRESS_OVERLAY_VIEW_IPC.measured, height)
}

contextBridge.exposeInMainWorld('hronautAddressOverlayView', api)

declare global {
  interface Window {
    hronautAddressOverlayView: HronautAddressOverlayViewApi
  }
}
