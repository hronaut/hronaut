/**
 * Errors from the main process that a person sees, and the startup failure page, in English. MCP results and logs keep
 * this text, except for an error that keeps its own message: a raw load failure, or one naming a tab, workspace or
 * bookmark by its internal ID.
 */
export const enUSAppErrors = {
  "startup": {
    "initializing": "Saved workspaces are still initializing. Try again after startup completes.",
    "unavailable": "Saved workspaces are unavailable.",
    "readUnavailable": "Workspace read is no longer available.",
    "tooManyReads": "Too many pending workspace reads.",
    "metadataUnavailable": "Saved workspace metadata is unavailable ({reason}). Startup stopped to preserve recovery options."
  },
  "sleep": {
    "onlyWebsites": "Only inactive website tabs can sleep.",
    "visible": "A visible tab cannot sleep.",
    "pinned": "Pinned tabs stay active.",
    "pageHold": "A tab with an explicit page hold stays active.",
    "loading": "A loading tab cannot sleep.",
    "audio": "A tab playing audio stays active.",
    "dialog": "A tab with an open dialog stays active.",
    "wallet": "A tab waiting on a wallet request stays active.",
    "devTools": "A tab with Developer Tools open stays active.",
    "interaction": "A tab with an active interaction stays active.",
    "video": "A tab recording video stays active.",
    "repro": "A tab recording reproduction steps stays active.",
    "domChanges": "A tab recording DOM changes stays active.",
    "liveRegion": "A tab recording a live region stays active.",
    "cssState": "A tab previewing a forced CSS state stays active.",
    "domMutationSource": "A tab capturing a DOM mutation source stays active.",
    "passkey": "A tab with a virtual passkey stays active.",
    "logpoints": "A tab with armed logpoints stays active.",
    "coverage": "A tab recording code coverage stays active.",
    "cpuProfile": "A tab recording a JavaScript CPU profile stays active.",
    "memory": "A tab recording memory allocations stays active.",
    "mcpCommand": "A tab with an active MCP command stays active.",
    "download": "A tab with an active download stays active.",
    "render": "A tab rendering a page capture or PDF stays active.",
    "unsavedForm": "This tab has a partially filled form and stays active to protect unsaved input."
  },
  "splitView": {
    "sameTab": "Choose a different tab for split view.",
    "home": "Hronaut Home cannot be opened in split view.",
    "currentUnavailable": "The current tab renderer is no longer available. Close the tab and reopen it from Recently closed.",
    "selectedUnavailable": "The selected tab renderer is no longer available. Close the tab and reopen it from Recently closed.",
    "notOpen": "Split view is not open."
  },
  "clipboard": {
    "textTooLarge": "The text is too large to copy safely (maximum 8 MB)",
    "textRejected": "The text was prepared, but the system clipboard did not accept it",
    "screenshotRejected": "The screenshot was captured, but the system clipboard did not accept the image",
    "pageClosed": "The page closed before its image could be copied",
    "imageRejected": "The page image was selected, but the system clipboard did not accept it"
  },
  "tabs": {
    "noActiveTab": "There is no active tab",
    "rendererUnavailable": "This tab renderer is no longer available. Close the tab and reopen it from Recently closed.",
    "limit": "Tab limit reached ({max})",
    "homeNotPinned": "Hronaut Home cannot be pinned",
    "homeNotReordered": "Hronaut Home cannot be reordered",
    "pinnedBoundary": "Pin or unpin a tab before moving it across the pinned boundary",
    "otherWorkspace": "Tabs can only be reordered within the same workspace",
    "homeNotDuplicated": "Hronaut Home cannot be duplicated",
    "homeInAgentWorkspace": "Hronaut Home is a human application page and cannot be added to an agent workspace.",
    "workspaceCleanupFailed": "The new tab failed and its workspace could not be cleaned up. The workspace remains available for recovery."
  },
  "page": {
    "rendererExitedDuringAction": "The page stopped during this action because its renderer exited; its effects are unknown. Reload or close the tab, then inspect fresh state.",
    "rendererExitedBeforeAction": "The page is not running because its renderer exited; nothing was sent to it. Reload or close the tab, then inspect fresh state.",
    "closedWhileWaiting": "The tab closed while waiting for the page.",
    "rendererLostWhileWaiting": "The tab renderer became unavailable while waiting for the page.",
    "loadTimedOut": "Timed out waiting for the page to finish loading.",
    "zoomPercent": "Page zoom percent must be an integer from 50 to 400",
    "findQuery": "Find query must contain between 1 and 1,000 characters"
  },
  "loadFailure": {
    "nameNotResolved": "The website address could not be found ({code}).",
    "connectionRefused": "The website refused the connection ({code}).",
    "offline": "The device appears to be offline ({code}).",
    "timedOut": "The website took too long to respond ({code}).",
    "connectionReset": "The connection was reset while loading the page ({code}).",
    "certificate": "Hronaut does not trust this website’s security certificate ({code})."
  },
  "navigation": {
    "homeInAgentWorkspace": "Hronaut Home is a human application page and cannot be opened inside an agent workspace.",
    "agentSchemes": "Agent workspaces cannot open local, privileged, or credential-bearing browser URLs.",
    "originBlocked": "Workspace navigation to {origin} is blocked. Allow this origin in the trusted workspace Site access settings.",
    "observerOrigin": "A public observer origin cannot be changed or widened.",
    "recoveryRunning": "The tab renderer is already being recovered.",
    "recoveryPageChanged": "The page changed while recovering its renderer.",
    "recoveryTabClosed": "The tab closed while recovering its renderer.",
    "recoveryTimedOut": "Timed out recovering the tab renderer."
  },
  "workspace": {
    "unavailable": "The workspace is no longer available.",
    "busyArchiving": "Workspace \"{name}\" is busy archiving the workspace. Try again after that operation finishes.",
    "busyClosing": "Workspace \"{name}\" is busy closing the workspace. Try again after that operation finishes.",
    "busyForking": "Workspace \"{name}\" is busy forking workspace data. Try again after that operation finishes.",
    "busyRestoring": "Workspace \"{name}\" is busy restoring the archived workspace. Try again after that operation finishes.",
    "busyClearingData": "Workspace \"{name}\" is busy clearing website data. Try again after that operation finishes.",
    "busyMovingData": "Workspace \"{name}\" is busy moving workspace data. Try again after that operation finishes.",
    "busyCopyingData": "Workspace \"{name}\" is busy copying workspace data. Try again after that operation finishes.",
    "busyImportingCookies": "Workspace \"{name}\" is busy importing browser cookies. Try again after that operation finishes."
  },
  "lifecycle": {
    "homeTab": "Only live page tabs can be frozen or resumed.",
    "sleeping": "Wake the sleeping tab before changing its page lifecycle.",
    "rendererUnavailable": "The tab renderer is unavailable.",
    "closedWhileChanging": "The tab closed while changing its page lifecycle.",
    "closedBeforeDispatch": "The tab closed before its page lifecycle command was dispatched.",
    "documentChanged": "The document changed before its page lifecycle command was dispatched.",
    "devTools": "Close Developer Tools for this tab before changing its page lifecycle."
  },
  "inputLock": {
    "pageBusy": "A page is busy. Input locks were not changed. Wait for its operation to finish, then try again.",
    "observer": "Page input remains locked in a read-only public observer workspace.",
    "tabClosed": "The tab closed before its input lock changed.",
    "tabNotRestored": "The tab’s input lock could not be updated or restored.",
    "allNotRestored": "Global interaction lock could not be updated or restored for every tab.",
    "allNotUpdated": "Global interaction lock could not be updated for every tab."
  },
  "agentPause": {
    "serviceUnavailable": "Agent service is unavailable"
  },
  "devTools": {
    "targetChanged": "Developer Tools handoff target changed",
    "conditionsPending": "Request-condition application is pending. Wait for it to settle before opening Developer Tools.",
    "conditionsChanged": "Request conditions changed before Developer Tools handoff"
  },
  "bookmarks": {
    "invalidUrl": "Bookmark URL must be an HTTP or HTTPS address within 4,096 encoded characters",
    "limit": "Bookmark limit reached ({max})",
    "duplicate": "This address is already bookmarked",
    "unavailable": "The bookmark is no longer available.",
    "collectionLimit": "Collection limit reached (50)",
    "collectionMissing": "Bookmark collection not found",
    "collectionNameTaken": "A bookmark collection with this name already exists",
    "collectionName": "Collection name must contain 1 to 80 characters",
    "storageUnavailable": "Bookmark storage is unavailable",
    "historyUnavailable": "Visit history is unavailable"
  },
  "startupScreen": {
    "title": "Hronaut could not start",
    "description": "The application shell could not load its initial settings.",
    "retry": "Try again",
    "privacy": "Your browser profile remains on this device.",
    "settingsUnavailable": "The renderer settings service is unavailable."
  }
}

/** The same keys in every language. */
export type AppErrorMessages = { [Group in keyof typeof enUSAppErrors]: Record<keyof typeof enUSAppErrors[Group], string> }
