import { contextBridge, ipcRenderer } from 'electron'
import type { AddressSuggestionOverlayState } from '../shared/address-suggestions.js'

export interface HronautAddressOverlayViewApi {
  onState(listener: (state: AddressSuggestionOverlayState) => void): () => void
  select(suggestionId: string): void
  measured(height: number): void
}

const api: HronautAddressOverlayViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AddressSuggestionOverlayState): void => listener(state)
    ipcRenderer.on('address-overlay:state', handler)
    return () => ipcRenderer.removeListener('address-overlay:state', handler)
  },
  select: (suggestionId) => ipcRenderer.send('address-overlay:select', suggestionId),
  measured: (height) => ipcRenderer.send('address-overlay:measured', height)
}

contextBridge.exposeInMainWorld('hronautAddressOverlayView', api)

declare global {
  interface Window {
    hronautAddressOverlayView: HronautAddressOverlayViewApi
  }
}
