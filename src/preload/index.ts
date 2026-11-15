import { contextBridge } from 'electron'
import { addressBarStopsApi } from './bridges/address-bar-stops.js'
import { addressOverlayApi } from './bridges/address-overlay.js'
import { agentCardApi } from './bridges/agent-card.js'
import { agentPresenceApi } from './bridges/agent-presence.js'
import { attentionApi } from './bridges/attention.js'
import { bookmarksApi } from './bridges/bookmarks.js'
import { browsingDataApi } from './bridges/browsing-data.js'
import { credentialsApi } from './bridges/credentials.js'
import { debugReportApi, pageAuditsApi, profilingApi, recordingApi, visualCompareApi } from './bridges/diagnostics.js'
import { downloadsApi } from './bridges/downloads.js'
import { emulationApi } from './bridges/emulation.js'
import { historyApi } from './bridges/history.js'
import { incidentsApi } from './bridges/incidents.js'
import { licenseApi } from './bridges/license.js'
import { mcpApi } from './bridges/mcp.js'
import { navigationApi } from './bridges/navigation.js'
import { networkRoutesApi } from './bridges/network-routes.js'
import { emulationFrameApi, pageCardApi, splitDividerApi } from './bridges/page-geometry.js'
import { consoleNetworkApi, pageCaptureApi, pageStorageApi } from './bridges/page-inspection.js'
import { panelWindowApi } from './bridges/panel-window.js'
import { permissionsApi } from './bridges/permissions.js'
import { qrCodeApi } from './bridges/qr-code.js'
import { settingsApi } from './bridges/settings.js'
import { appApi, shellApi, shellRequestsApi } from './bridges/shell.js'
import { sidebarOverlayApi } from './bridges/sidebar-overlay.js'
import { tabsApi } from './bridges/tabs.js'
import { taskManagerApi } from './bridges/task-manager.js'
import { toastOverlayApi } from './bridges/toast-overlay.js'
import { trustedDialogsApi } from './bridges/trusted-dialogs.js'
import { undoApi } from './bridges/undo.js'
import { updatesApi } from './bridges/updates.js'
import { walletsApi } from './bridges/wallets.js'
import { workspacesApi } from './bridges/workspaces.js'
import type { HronautApi } from '../shared/types.js'

const api: HronautApi = {
  ...tabsApi,
  ...navigationApi,
  ...undoApi,
  ...attentionApi,
  ...qrCodeApi,
  ...appApi,
  ...shellRequestsApi,
  ...workspacesApi,
  ...emulationApi,
  ...networkRoutesApi,
  ...addressBarStopsApi,
  ...incidentsApi,
  ...pageStorageApi,
  ...pageCaptureApi,
  ...consoleNetworkApi,
  ...pageAuditsApi,
  ...profilingApi,
  ...debugReportApi,
  ...recordingApi,
  ...visualCompareApi
}

contextBridge.exposeInMainWorld('hronaut', api)
contextBridge.exposeInMainWorld('hronautDownloads', downloadsApi)
contextBridge.exposeInMainWorld('hronautTaskManager', taskManagerApi)
contextBridge.exposeInMainWorld('hronautBookmarks', bookmarksApi)
contextBridge.exposeInMainWorld('hronautHistory', historyApi)
contextBridge.exposeInMainWorld('hronautBrowsingData', browsingDataApi)
contextBridge.exposeInMainWorld('hronautMcp', mcpApi)
contextBridge.exposeInMainWorld('hronautWallets', walletsApi)
contextBridge.exposeInMainWorld('hronautSettings', settingsApi)
contextBridge.exposeInMainWorld('hronautPermissions', permissionsApi)
contextBridge.exposeInMainWorld('hronautCredentials', credentialsApi)
contextBridge.exposeInMainWorld('hronautLicense', licenseApi)
contextBridge.exposeInMainWorld('hronautUpdates', updatesApi)
contextBridge.exposeInMainWorld('hronautPanelWindow', panelWindowApi)
contextBridge.exposeInMainWorld('hronautAddressOverlay', addressOverlayApi)
contextBridge.exposeInMainWorld('hronautShell', shellApi)
contextBridge.exposeInMainWorld('hronautSplitDivider', splitDividerApi)
contextBridge.exposeInMainWorld('hronautEmulationFrame', emulationFrameApi)
contextBridge.exposeInMainWorld('hronautPageCard', pageCardApi)
contextBridge.exposeInMainWorld('hronautAgentPresence', agentPresenceApi)
contextBridge.exposeInMainWorld('hronautAgentCard', agentCardApi)
contextBridge.exposeInMainWorld('hronautTrustedDialogs', trustedDialogsApi)
contextBridge.exposeInMainWorld('hronautToastOverlay', toastOverlayApi)

// Only the main window's shell opens its tab rail over the page; a detached panel's window has no rail.
if (process.argv.includes('--hronaut-window-kind=main')) contextBridge.exposeInMainWorld('hronautSidebarOverlay', sidebarOverlayApi)
