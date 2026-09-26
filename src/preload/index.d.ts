import type { HronautSplitDividerApi } from '../shared/split-view'
import type { HronautHomeApi } from '../shared/home'
import type { HronautApi, HronautBookmarksApi, HronautBrowsingDataApi, HronautCredentialsApi, HronautDownloadsApi, HronautHistoryApi, HronautLicenseApi, HronautMcpApi, HronautPanelWindowApi, HronautPermissionsApi, HronautSettingsApi, HronautShellApi, HronautUpdatesApi, HronautWalletsApi } from '../shared/types'
import type { AddressSuggestionOverlayRequest, AddressSuggestionSelection } from '../shared/address-suggestions'

declare global {
  interface Window {
    hronautHome: HronautHomeApi
    hronaut: HronautApi
    hronautSplitDivider: HronautSplitDividerApi
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
      onSelected(listener: (selection: AddressSuggestionSelection) => void): () => void
      onDismissed(listener: (sessionId: number) => void): () => void
    }
    hronautShell: HronautShellApi
  }
}

export {}
