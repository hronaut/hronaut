/** Errors from the main process that a person sees, in English; MCP results and logs keep this text. */
export const enUSAppErrors = {
  "startup": {
    "initializing": "Saved workspaces are still initializing. Try again after startup completes.",
    "unavailable": "Saved workspaces are unavailable.",
    "readUnavailable": "Workspace read is no longer available.",
    "tooManyReads": "Too many pending workspace reads."
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
