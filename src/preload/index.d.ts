import type { HronautApi, HronautBookmarksApi, HronautBrowsingDataApi, HronautCredentialsApi, HronautDownloadsApi, HronautHistoryApi, HronautLicenseApi, HronautMcpApi, HronautPanelWindowApi, HronautPermissionsApi, HronautSettingsApi, HronautShellApi, HronautUpdatesApi } from '../shared/types'
import type { AddressSuggestionOverlayRequest } from '../shared/address-suggestions'

declare global {
  interface Window {
    hronaut: HronautApi
    hronautBookmarks: HronautBookmarksApi
    hronautHistory: HronautHistoryApi
    hronautBrowsingData: HronautBrowsingDataApi
    hronautDownloads: HronautDownloadsApi
    hronautMcp: HronautMcpApi
    hronautCredentials: HronautCredentialsApi
    hronautPermissions: HronautPermissionsApi
    hronautSettings: HronautSettingsApi
    hronautUpdates: HronautUpdatesApi
    hronautLicense: HronautLicenseApi
    hronautPanelWindow: HronautPanelWindowApi
    hronautAddressOverlay: {
      show(request: AddressSuggestionOverlayRequest): void
      hide(): void
      onSelected(listener: (suggestionId: string) => void): () => void
      onDismissed(listener: () => void): () => void
    }
    hronautShell: HronautShellApi
  }
}

export {}
