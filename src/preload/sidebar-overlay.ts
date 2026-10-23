import { contextBridge, ipcRenderer } from 'electron'
import type { HronautSidebarOverlayViewApi, SidebarOverlayState } from '../shared/sidebar-overlay.js'

const api: HronautSidebarOverlayViewApi = {
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: SidebarOverlayState): void => listener(state)
    ipcRenderer.on('sidebar-overlay-view:state', handler)
    return () => ipcRenderer.removeListener('sidebar-overlay-view:state', handler)
  },
  rendered: (report) => ipcRenderer.send('sidebar-overlay-view:rendered', report),
  pointer: (pointer) => ipcRenderer.send('sidebar-overlay-view:pointer', pointer),
  intent: (intent) => ipcRenderer.send('sidebar-overlay-view:intent', intent),
  showTooltip: (request) => ipcRenderer.send('sidebar-overlay-view:tooltip-show', request),
  hideTooltip: (id) => ipcRenderer.send('sidebar-overlay-view:tooltip-hide', id)
}

contextBridge.exposeInMainWorld('hronautSidebarOverlayView', api)

declare global {
  interface Window {
    hronautSidebarOverlayView: HronautSidebarOverlayViewApi
  }
}
