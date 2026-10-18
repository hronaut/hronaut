/**
 * Every isolated world Hronaut runs page scripts in. Each feature owns one world, so its page-side
 * globals and state can never collide with another feature's. Electron accepts 1 to 536870911;
 * 0 is the page's main world and 999 is Electron's context-isolation world. Add new worlds here
 * instead of numbering them in the owning module.
 */
export const ISOLATED_WORLDS = {
  accessibilityAudit: 1001,
  performanceAudit: 1002,
  designOverview: 1003,
  pageMetadata: 1004,
  domChanges: 1005,
  elementInspection: 1006,
  indexedDb: 1007,
  pwaInspector: 1008,
  storageUsage: 1009,
  presentedViewVisibility: 1010,
  continuityMarker: 1011,
  postcondition: 1012,
  agentPointer: 1013,
  reconciliation: 1014,
  observationQuality: 1015,
  credentialCapture: 1016,
  visualCompare: 1017,
  screenshotAnnotation: 1018,
  pwaLifecycle: 1019,
  mediaState: 1020,
  multiSelect: 1021,
  imageState: 1022,
  snapshot: 1023,
  liveRegion: 1024,
  fileDrop: 1025,
  shadowSnapshot: 1026,
  screenshotObservation: 1027,
  textInsertion: 1028,
  textFileFill: 1029,
  faviconDecoder: 1100
} as const satisfies Record<string, number>

export type IsolatedWorldName = keyof typeof ISOLATED_WORLDS

/** Worlds Hronaut must never use: the page's main world and Electron's context-isolation world. */
export const RESERVED_WORLD_IDS: readonly number[] = [0, 999]
export const MAX_ISOLATED_WORLD_ID = 536_870_911
