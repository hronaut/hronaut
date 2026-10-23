import type { HronautSplitDividerApi } from '../shared/split-view'
import type { HronautEmulationFrameApi } from '../shared/emulation-frame'
import type { HronautPageCardApi } from '../shared/page-card'
import type { HronautAgentCardApi } from '../shared/agent-card'
import type { HronautToastOverlayApi } from '../shared/toast-overlay'
import type { HronautSidebarOverlayApi } from '../shared/sidebar-overlay'
import type { HronautTrustedDialogsApi } from '../shared/trusted-dialogs'
import type { HronautAgentPresenceApi } from '../shared/agent-presence'
import type { HronautHomeApi } from '../shared/home'
import type { HronautApi, HronautBookmarksApi, HronautBrowsingDataApi, HronautCredentialsApi, HronautDownloadsApi, HronautHistoryApi, HronautLicenseApi, HronautMcpApi, HronautPanelWindowApi, HronautPermissionsApi, HronautSettingsApi, HronautShellApi, HronautUpdatesApi, HronautWalletsApi } from '../shared/types'
import type { AddressSuggestionOverlayRequest, AddressSuggestionSelection } from '../shared/address-suggestions'

declare global {
  interface Window {
    hronautHome: HronautHomeApi
    hronaut: HronautApi
    hronautSplitDivider: HronautSplitDividerApi
    hronautEmulationFrame: HronautEmulationFrameApi
    hronautPageCard: HronautPageCardApi
    hronautAgentPresence: HronautAgentPresenceApi
    hronautAgentCard: HronautAgentCardApi
    hronautToastOverlay: HronautToastOverlayApi
    /** Hronaut's own dialogs that main asks the person, drawn over the page. */
    hronautTrustedDialogs: HronautTrustedDialogsApi
    /** Opens the tab rail over the page while it is collapsed when not in use; without it the rail opens beside the page. */
    hronautSidebarOverlay?: HronautSidebarOverlayApi
    hronautBookmarks: HronautBookmarksApi
    hronautHistory: HronautHistoryApi
    hronautBrowsingData: HronautBrowsingDataApi
    hronautDownloads: HronautDownloadsApi
    hronautMcp: HronautMcpApi
    hronautWallets: HronautWalletsApi
    hronautCredentials: HronautCredentialsApi
    hronautPermissions: HronautPermissionsApi
    hronautSettings: HronautSettingsApi
    hronautUpdates: HronautUpdatesApi
    hronautLicense: HronautLicenseApi
    hronautPanelWindow: HronautPanelWindowApi
    hronautAddressOverlay: {
      show(request: AddressSuggestionOverlayRequest): void
      hide(): void
      /** Gives the keyboard back to the address field after a middle-click on a suggestion took it. */
      returnFocus(): void
      onSelected(listener: (selection: AddressSuggestionSelection) => void): () => void
      onDismissed(listener: (sessionId: number) => void): () => void
    }
    hronautShell: HronautShellApi
  }
}

export {}
