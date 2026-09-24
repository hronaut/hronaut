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

2. **Pause and resume downloads in the current session — implemented and verified for v2.5.19.** The extracted downloads
   controller gives this a focused home. [Firefox's download manager](https://support.mozilla.org/en-US/kb/where-find-and-manage-downloaded-files-firefox)
   already exposes pause/resume; [Electron's DownloadItem API](https://www.electronjs.org/docs/latest/api/download-item)
   provides the native operations and availability state. Typed IPC/MCP actions
   and accessible panel controls now preserve workspace and observation-generation
   checks. All 3,077 unit/component tests, 517 local Docker Electron cases,
   native-dialog checks, and all five hosted Docker shards passed. The four
   focused Electron cases also passed three consecutive runs. Focused coverage
   includes byte-exact continuation and restart,
   panel pause, MCP resume, cross-workspace rejection, and paused cancellation. Keep terminal interruptions distinct from resumable ones.
   Test pause/resume, cancellation while paused, stale workspace access, and
   server behavior with and without range support and validators. Electron says
   byte continuation needs range requests plus Last-Modified and ETag; otherwise
   resuming restarts from the beginning. UI must tolerate progress decreasing.
   Cross-restart recovery needs a separate persistence and partial-file validation
   design; it is not implied by this proposal.

## Rotating QA review

### Community workflow follow-up (September 24)

Re-read [discussion #201](https://github.com/orgs/hronaut/discussions/201).
The proposed next external check is Windows browser-UI interaction with an
account-free React application: read a human-edited value, decline a proposed
write and verify the value is unchanged, then navigate from Todos to Profile
while a decision is pending and read back route, value and decision state.
This is a proposed experiment, not a reported compatibility pass. Check access
to the Windows loopback endpoint before using a container-backed client; use
a Windows-local client if that boundary cannot be reached. An RCIP bridge is
a separate feature decision and should wait for evidence from the UI experiment.
The linked starter could not be retrieved during this review, so its current
implementation and behavior remain unverified. Do not infer them from the
discussion or add a product integration on that basis.

The website repository's latest commit is `7b251b4`, which validates release
download links against the advertised tag. Open website issues #22 (community
hub), #5 (reviewer grants), and #2 (Search Console) remain separate work items;
their presence is not evidence of a newly reproduced website defect.

### Community release-reference consistency (September 24)

The latest edit to [discussion #201](https://github.com/orgs/hronaut/discussions/201)
labels its welcome section v2.5.18, but its Registry link still targets the
v2.5.16 record and its feature summary describes the v2.5.16 changelog. Direct
reads of both official Registry records confirmed that each returns the version
in its URL; the older record is not marked latest. When the announcement is next
edited, update its release label, Registry URL, adapter guide, and feature summary
together. Keep the explicitly versioned v2.4.22/jsdom and v2.4.24 demonstration
claims unchanged. No new external compatibility result was posted in the recent
comments, and no public discussion message was sent during this review. A second
read after the v2.5.18 announcement confirmed that the same link and summary
mismatch remains; the website repository is still at `7b251b4` with the same
three open issues.

### Wallet discovery follow-up (September 24)

Re-read [discussion #212](https://github.com/orgs/hronaut/discussions/212).
Its older jsdom and local-chain demonstrations remain version-specific. Added
`tests/integration/wallet-discovery.e2e.ts` against the current Electron build:
late EVM/TRON discovery listeners receive separate announcements, repeated
requests after a same-document route change preserve provider identity and
frozen metadata, and the wallet request list stays empty. The focused Docker
case passed. This checks discovery only; it is not a transaction, external
wallet, installer or protocol-conformance result.

### Completed QA and next boundaries

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

- Consolidated network-route input schemas and normalization in
  `src/main/browser/network-route-input.ts`. IPC and MCP use the same field
  contracts, and the browser manager validates before changing native routes.
  Coverage includes behavior conflicts, UTF-8 byte limits, header limits and
  prototype-like header names. Two real Electron regressions reproduced loss
  of `__proto__` through both shell IPC and MCP; header records now preserve it
  as an own string property without changing their prototype.
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
- Electron trace completeness is covered by `electron-tracing.e2e.ts`: intentional
  failures retain browser frame snapshots, manual restarts retain both contexts,
  and passing or tracing-disabled fixtures retain none. Keep this regression
  when changing startup or trace ownership.
- A local four-shard run of the 2.5.17 candidate intermittently failed to find
  the Home page through Playwright in `workspace-library.e2e.ts`; three focused
  Docker repetitions and the release five-shard run passed. The failure was at
  initial page discovery, not a workspace mutation assertion. Preserve native
  WebContents state and Playwright page inventory on recurrence before changing
  timing or treating this as a product defect.
- Wallet broker connection setup and the workspace-detachment case now await
  broker pending-state notifications. Release CI previously exhausted the
  separate one-second polling default during asynchronous persistence; the
  owning 85-case Docker suite passes with the event-driven fixture.
