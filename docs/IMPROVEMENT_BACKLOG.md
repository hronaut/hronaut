# Improvement research and QA queue

Reviewed 2026-09-24 against the current README, REFERENCE, renderer controllers,
and shared audit contracts. These are proposals, not shipped features.

## Priorities

1. **CSS edit review — defer pending workflow evidence.** Hronaut provides native
   DevTools and a read-only Design overview, but no separate CSS editing flow.
   Chrome's [Changes panel](https://developer.chrome.com/docs/devtools/changes)
   already shows edits made in DevTools, with copy and revert actions; its edits
   disappear after a page or DevTools reload unless local overrides or a source
   workspace is configured. A second Hronaut editor would need a clear persistence
   contract and would compete with DevTools for the one debugger connection.
   Gather a concrete workflow that the existing Changes panel cannot serve
   before implementing another editor.

## Rotating QA review

Completed in the current Unreleased cycle: accessibility comparison now keeps a
volatile tab baseline, compares deduplicated rule-and-target fingerprints, flags
scope, engine and URL drift, and withholds new or resolved classifications when
the corresponding audit side is truncated. Unit, renderer and real MCP/Electron
coverage includes reordering, duplicates, truncation, navigation, clearing and
tab closure. Repro review now provides a selectable timeline and a focused action,
target, page and relative-time view. Pointer and Arrow/Home/End coverage includes
empty, 200-step capped and replacement-recording states while retaining the
existing bounded, redacted evidence contract.

### Electron upgrade evidence (issue #1)

Rechecked 2026-09-09. The upstream stable-release prerequisite is satisfied:
[Electron 44.1.0 release notes](https://github.com/electron/electron/releases/tag/v44.1.0)
explicitly include the Linux tray fix from
[backport #53214](https://github.com/electron/electron/pull/53214).
[Electron 44.3.0](https://github.com/electron/electron/releases/tag/v44.3.0),
published September 8, is the latest stable release observed in this check.
The [commit comparison](https://github.com/electron/electron/compare/bb27a30d9262e4ad6e1eb12921d5792fa7175e96...v44.3.0)
places its tag 90 commits ahead and zero behind the tray backport merge.
This verifies inclusion, not only issue closure.

The maintenance update advances the existing 44-series pin to 44.3.0 for its
upstream crash and permission fixes, including a separate Linux sandbox tray
fix. Keep [Hronaut #1](https://github.com/hronaut/hronaut/issues/1) open until its
remaining packaged-app evidence is complete: GNOME with AppIndicator, KDE plus
Xfce or Cinnamon, icon/click/menu/attention/quit behavior, and Windows/macOS
lifecycle smoke. Dependency audit and automated Docker gates do not substitute
for those desktop checks.

Navigation context review completed 2026-09-24: `useDiagnosticsController` and
page export already invalidate pending results by navigation generation. The
active-tab shell now resets stale panels for a same-document navigation that
keeps the URL unchanged; unit and Electron regressions cover that case. Normal
same-URL reloads still reset at loading start without a duplicate reset at
commit, and detached panels retain their separate open-state behavior.

- Pending actions: success and rejection after navigation, same-URL reload,
  tab switch, dialog close/reopen, and disposal; newer actions must retain state.
- Workspace transfers: empty source, deselected origins, archived source and
  destination, source removal while loading, partial cleanup, and refresh failure.
- UI: keyboard focus, minimum window size, large interface scale, long translated
  labels, detached panels, and empty/error/loading states.
- For every reproduced bug, demonstrate a failing regression test before fixing
  it. Run focused Docker tests during iteration and the immutable Docker/Xvfb
  integration gate before delivery. Preserve failure evidence and distinguish
  product failures from setup or resource failures.
- Release a coherent verified batch through the existing immutable-tag workflow,
  with Unreleased notes, static gates, Docker integration, and platform packaging.
  Passing automation is evidence of covered behavior, not proof of zero bugs.

## Test infrastructure follow-up

- Completed September 22: split the MCP capability tour into 13 independently
  initialized cases covering interaction, storage, network, diagnostics, and
  exports. The shared `capability-fixtures.ts` owns each case's HTTP server,
  sockets, MCP connection, workspace, and tab within an isolated Electron profile.
  All 731 original `expect()` calls remain, with explicit setup for network
  timing, failed responses, and emulation isolation. Cases use the normal
  45-second deadline and can be sharded independently.
- Extracted coverage, CPU profiling, and memory sampling into
  `src/main/browser/profiling-controller.ts`. The browser manager still owns
  tab lookup, debugger leases, navigation preparation, and state publication;
  the controller preserves tab identity and generation checks for pending memory
  measurements. Continue extracting cohesive responsibilities incrementally.
- Investigate Electron trace completeness. The retained capability failure ZIP
  contained `test.trace` and resources, but no browser snapshots. Check explicit
  tracing of the Electron context and prove that a deliberate synthetic failure
  produces usable shell screenshots and snapshots before changing CI retention.
