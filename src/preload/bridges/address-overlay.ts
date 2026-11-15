import type { HronautAddressOverlayApi } from '../../shared/address-suggestions.js'
import { ADDRESS_OVERLAY_IPC } from '../../shared/ipc/address-overlay.js'
import { send, subscribe } from './ipc.js'

/** window.hronautAddressOverlay: the address field's suggestions, which main draws over the page. */
export const addressOverlayApi: HronautAddressOverlayApi = {
  show: (request) => send(ADDRESS_OVERLAY_IPC.show, request),
  hide: () => send(ADDRESS_OVERLAY_IPC.hide),
  returnFocus: () => send(ADDRESS_OVERLAY_IPC.returnFocus),
  onSelected: (listener) => subscribe(ADDRESS_OVERLAY_IPC.selected, (selection) => listener(selection)),
  onDismissed: (listener) => subscribe(ADDRESS_OVERLAY_IPC.dismissed, (sessionId) => listener(sessionId))
}
