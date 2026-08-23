import type { BrowserActionFailure, HronautApi, HronautBookmarksApi, HronautBrowsingDataApi, HronautCredentialsApi, HronautDownloadsApi, HronautHistoryApi, HronautLicenseApi, HronautMcpApi, HronautPanelWindowApi, HronautPermissionsApi, HronautSettingsApi, HronautUpdatesApi, HelpMenuAction } from '../shared/types'
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
    hronautShell: {
      setToolbarHeight(height: number): void
      setContentInsets(insets: { top: number; right: number; bottom: number; left: number }): void
      onHelpRequested(listener: (action: HelpMenuAction) => void): () => void
      onClipboardFailed(listener: (message: string) => void): () => void
      onActionFailed(listener: (failure: BrowserActionFailure) => void): () => void
    }
  }
}

export {}
