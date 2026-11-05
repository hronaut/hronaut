// Report caveats for Page performance, the Accessibility audit comparison, the IndexedDB inspector and Site storage, keyed as
// PERFORMANCE_REPORT_CAVEATS, PERFORMANCE_COMPARISON_CAVEATS (src/shared/performance-audit.ts),
// ACCESSIBILITY_COMPARISON_CAVEATS (src/shared/accessibility-comparison.ts), INDEXEDDB_CAVEATS (src/shared/indexeddb.ts),
// STORAGE_USAGE_CAVEATS (src/shared/storage-usage.ts), STORAGE_CHANGES_CAVEATS (src/shared/storage-changes.ts) and
// PWA_INSPECTION_CAVEATS (src/shared/pwa.ts). Reports address agents; here the same points are worded for the person
// reading the panel.
export const enUSReportCaveats = {
  performance: {
    lcpPhases: 'LCP phases are browser-timing observations, not causal proof. Missing or restricted evidence is explicit; restoration and soft-navigation phase attribution are unsupported.',
    localSample: 'This is one local current-visit sample, not field data or a 75th-percentile CrUX result.',
    inpUnavailable: 'INP is unavailable until the page receives a qualifying interaction; some metrics are unavailable for background or short-lived visits.',
    longAnimationFrames: 'Long animation frame attribution identifies script entry points rather than necessarily the slowest internal function.',
    crossOrigin: 'Cross-origin frames, workers, service workers, and isolated-world code may contribute work without script attribution.',
    userTimings: 'User Timing names are page-authored and sanitized; arbitrary detail objects, stack traces, and source code are omitted.',
    layoutShifts: 'Layout-shift evidence excludes entries with recent discrete input. Its score sum is diagnostic and may differ from CLS session-window scoring.',
    baselineUrl: 'The baseline URL differs from this measurement; compare only if the navigation change was intentional.',
    environment: 'The browser environment differs from the baseline; viewport, throttling, cache, headers, or locale changes can affect the delta.',
    deltas: 'Before-and-after deltas compare two local samples and may include normal run-to-run variation; repeat important measurements under matching conditions.'
  },
  accessibilityComparison: {
    urlChanged: 'The page URL changed after the accessibility baseline.',
    scopeChanged: 'The accessibility standard, selector, or collection limits changed; set a new baseline for this scope.',
    engineChanged: 'The accessibility engine changed; set a new baseline before comparing findings.',
    baselineTruncated: 'The baseline was truncated, so new findings cannot be determined safely.',
    currentTruncated: 'The current audit was truncated, so resolved findings cannot be determined safely.'
  },
  indexedDb: {
    origin: 'Only this top-level origin is covered; databases in third-party frames are not included.',
    snapshot: 'Databases and records are a point-in-time snapshot. Refresh after the website changes IndexedDB.',
    names: 'Database, object store, index and key names are written by the website and can themselves contain private data.',
    longNames: 'Databases and object stores with names longer than 512 characters are left out.',
    valuesIncluded: 'Record previews are bounded and may contain private application data.',
    valuesOmitted: 'Record values are left out.',
    readOnly: 'This inspector only reads IndexedDB and never changes or clears it.'
  },
  storageUsage: {
    estimates: 'Usage and quota are point-in-time browser estimates and may change as Chromium evicts or writes data.',
    quota: 'Quota is the budget Chromium currently reports for this origin, not the free space on the device.',
    origin: 'Only this top-level HTTP(S) origin is covered; third-party and partitioned storage can be counted separately.',
    aggregates: "Only total byte counts and the browser's storage categories are shown. Keys, values, file names and response bodies are never included.",
    readOnly: 'This inspector only reads storage usage and never changes or clears data.',
    fallback: "Chromium's detailed quota breakdown was unavailable, so this report uses the browser's overall estimate: {reason}"
  },
  storageChanges: {
    baseline: 'The baseline stays only in memory and is discarded when you clear it, when the tab changes origin or closes, or when Hronaut exits.',
    scope: 'Local storage and cookies are shared by origin within this workspace and isolated from other workspaces; session storage belongs only to this tab.',
    valuesIncluded: 'Values are shown up to a size limit. HttpOnly cookie values always stay protected.',
    valuesOmitted: 'Values are left out.',
    snapshot: 'The snapshot covers the first 200 sorted entries of each storage kind. Storage can also change in the background between the baseline and the comparison.'
  },
  pwa: {
    origin: 'Only this top-level origin is covered; workers and caches in third-party frames are not included.',
    snapshot: 'Registrations and cached entries are a point-in-time snapshot. Refresh after the website changes its offline state.',
    manifest: 'The manifest is read into a few bounded fields; its raw source is never shown.',
    installabilityIds: 'Installability error identifiers come from Chromium and can change between Chromium versions.',
    readOnly: 'This inspector only reads offline data and never shows cached response bodies.',
    headersIncluded: 'Request and response headers are shown up to a limit; recognized secret-bearing headers are redacted.',
    headersOmitted: 'Header values are left out.',
    opaqueSizes: "Sizes of opaque responses can include the browser's quota padding and are not measured here.",
    clearing: 'This inspector never unregisters workers or clears caches.',
    installabilityUnavailable: 'Installability diagnostics were unavailable: {reason}'
  }
}
