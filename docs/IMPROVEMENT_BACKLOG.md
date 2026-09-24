# Improvement research and QA queue

Reviewed 2026-09-24 against the current README, REFERENCE, renderer controllers,
and shared audit contracts. Entries distinguish proposals from completed work.

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

3. **Explicit recorder assertions — proposed after the maintenance release.**
   [Playwright's generator](https://playwright.dev/docs/codegen) lets users select
   visibility, text, and value assertions. Hronaut's Playwright export deliberately
   ends with a TODO error until an expected result is added. A user-selected
   visibility assertion could reduce that manual work while keeping expected
   behavior explicit. Reuse the element picker, retain bounded selectors and
   recording limits, and reject results from obsolete page/recording contexts.
   Cover hidden/removed elements, duplicate selectors, frame support, export
   escaping, and concurrent stop. Text/value capture needs a separate explicit
   privacy contract. This is research, not an implemented assertion or replay
   feature; the current TODO remains appropriate for action-only recordings.
   See [the implementation proposal](RECORDER_ASSERTIONS_PLAN.md) for picker
   boundaries, cancellation rules, and required end-to-end evidence.

## Developer feedback speed

The full Docker dependency stage now separates release metadata from installation
inputs and shares its supported manifest fields with the focused launcher and
manifest verifier. In a local two-build check, the initial dependency image took
179.98 seconds to build; a release-version-only rebuild took 5.68 seconds.
The second build marked the `npm ci`, native dependency installation, and OS-package
layers cached; both images had identical filesystem layer digests. These are local
measurements, not a hosted CI timing guarantee. Dependency entries and root install
constraints remain part of the copied inputs, and the immutable integration image
still receives the original manifest and complete source checkout.

Scoop publication now retains its manifest tests and dedicated Windows smoke
workflow without dispatching a second full application CI run. The redundant
manual dispatch canceled in-progress application checks after both the 2.5.20
and 2.5.21 manifest updates. Ordinary pushes, pull requests, and release gates
retain their existing full validation. The bot stages only the manifest; its
commit intentionally receives the package-specific checks instead.

## Refactoring boundaries

Diagnostic IPC registration now lives in `src/main/diagnostics-ipc.ts`, beside
wallet and collection registration modules. The main entry point supplies lazy
browser access, sender authorization, and image/clipboard adapters; the extracted
module retains argument checks and result forwarding. This keeps native setup
out of focused boundary tests without moving browser authority into the renderer.

Reproduction recording now lives in `src/main/browser/repro-recorder.ts`.
Public actions, pending start/stop ownership, input queues, scroll debounce,
navigation updates, and cleanup move together. `BrowserTabsManager` retains tab
lookup, workspace authority, and native event wiring; it supplies current-tab and
agent-input checks plus state-change notification. Existing navigation, clear,
restart, closure, and concurrent-stop regression suites cover this boundary.

DOM recording now has a matching focused module in
`src/main/browser/dom-recorder.ts`. It owns isolated-world execution and request
ordering, while the manager retains authoritative tab lookup and navigation
cleanup. The eleven lifecycle regressions cover obsolete pages, later actions,
and refresh results arriving out of order. Six focused unit cases additionally
cover workspace ownership, replaced or destroyed contents, removed tabs, stale
workspace cleanup, and a failed refresh while Start is pending.

Network waiter lifecycle now lives in
`src/main/browser/network-wait-controller.ts`. Timer ownership, per-tab limits,
completion, cancellation, and shutdown cleanup move together. The manager keeps
tab access, cursor validation, request matching, and sanitized summaries. Seven
unit cases cover retained results, registration races, workspace ownership,
capacity recovery, tab isolation, disposal, and clock changes. The three native
MCP network/wait cases also pass, including renderer loss and teardown.
Reported elapsed time uses a monotonic clock: regressions proved that forward
and backward system-clock changes previously distorted `waitedMs`.

Native selection completion now lives in
`src/main/browser/native-selection-session.ts`. Element picking extends the
original session object so promise callbacks and queued native input share the
same completion state. Previously, spreading the session copied `settled` while
callbacks updated the original object. Three regression cases failed with that
copy; six cases cover completion and late resolve/reject callbacks for both
selection types. Four focused Electron cases cover picker output, screenshot
output, modal priority, and navigation cancellation. This fixes the internal
state invariant; no duplicate-selection symptom or renderer crash cause was
established from it.

Emulation configuration now lives in `src/main/browser/emulation-state.ts`:
option validation, defaults, reset/merge behavior, state cloning, and override
detection can be tested without Electron. The manager retains tab authorization,
native debugger commands, rollback, and state-change notification. Rendering
overlay defaults are shared with the environment UI. Tests cover reset and clear
semantics, nested state isolation, viewport limits, private header handling, and
unsupported inherited overlay names; the latter three cases failed before the
validation changed from prototype membership to own-property membership.

Emulation updates now keep rebasing, native application, rollback, and state
commit inside the existing per-tab debugger queue. Two Electron regressions
failed before the fix: a simultaneous viewport change discarded a completed
dark-mode change, and a failed earlier update rolled back a successful later
viewport while stored state still reported 390px. The queued transaction keeps
stored and native settings aligned. Seven focused native cases cover both races
alongside emulation reset, isolation, validation, and performance comparisons.

Performance environment fingerprints now live in
`src/main/browser/performance-environment.ts`. Object keys are ordered before
hashing, so applying equivalent settings in separate actions or in one action
does not create a false baseline mismatch. Two unit regressions and one real
Electron comparison failed before this change. Tests also retain detection of
actual locale, private header, viewport, and zoom changes; private values remain
inside the hash rather than the public performance environment summary.

Release and maintenance scripts now share `scripts/is-main-module.ts` for direct
execution checks. Comparing canonical filesystem paths supports directory aliases
while retaining import-only behavior in tests. The bundled operator metadata
generator previously exited successfully without writing its output through a
symlinked directory; the real MCPB packaging regression failed before this fix.
The same helper replaces eight duplicated CLI checks.

Debugger actions and explicit page lifecycle changes now share scheduling in
`src/main/browser/debugger-queue.ts`. Six focused unit cases cover ordering,
independent tabs, failed commands, caller deadlines, DevTools handoff, and shutdown
bookkeeping. A timed-out native command retains its queue slot until it actually
settles; Electron attachment and document authority remain in the manager.
All eight focused native cases pass after extraction, covering emulation,
rollback ordering, the stale-document regression, explicit page holds, and
DevTools handoff. Focused lint and typechecking pass as well.
Review also found a queued-freeze navigation race:
the lifecycle command checked the document generation only after dispatch. A real
Electron regression holds an earlier emulation command, queues Freeze, then
navigates before releasing the queue. It observed a freeze command sent to the new
document on both attempts. Lifecycle dispatch now checks tab/content identity and
document generation both after acquiring the queue and after debugger attachment.
The regression and three related native cases now pass, including explicit
freeze/resume and emulation serialization; focused lint and typechecking pass.
Full static and immutable-image verification remain required before delivery.

### Next bounded extractions

A fresh review after the debugger-queue and Home work identified these candidates;
they are proposals, not completed changes or confirmed defects:

1. **Tab overview thumbnail scheduling.** Move the per-tab settle timers,
   coalesced requests, process-wide capture queue, timeout handling, and late
   completion recovery out of `tabs-manager.ts` together. Keep current tab,
   navigation, visibility, and workspace eligibility supplied by the manager.
   Characterize a pending capture followed by navigation, closure, timeout,
   rejection, and a newer request before moving code. Preserve the difference
   between releasing the global queue on timeout and avoiding duplicate native
   captures for that page. The separate full-page preview path is a later change.
2. **Network diagnostic event reduction.** The large `handleNetworkDebuggerMessage`
   switch combines CDP payload parsing with bounded request/WebSocket/SSE history
   mutation. A focused reducer can own those transitions while the manager owns
   session hooks, debugger attachment, route dispatch, and workspace access.
   Preserve capture sequence, observation generation, redaction, eviction, and
   out-of-order event handling; retain the real MCP network tests.
3. **Page diagnostic attachment lifecycle.** `ensureDialogMonitoring` now enables
   several domains, network routes, input policy, and emulation, so its name and
   placement obscure its broader responsibility. Extract attachment/handoff only
   after its invariants are covered: DevTools opening during attach, destruction,
   failed domain enablement, and retained emulation. Keep command scheduling in
   the existing debugger queue rather than creating another competing queue.

## Rotating QA review

### Community workflow follow-up (September 24)

Re-read [discussion #201](https://github.com/orgs/hronaut/discussions/201).
The proposed next external check is Windows browser-UI interaction with an
account-free React application: read a human-edited value, decline a proposed
write and verify the value is unchanged, then navigate from Todos to Profile
while a decision is pending and read back route, value and decision state.
The September 24, 18:49 UTC maintainer reply agrees to this browser-UI-only
scope on v2.5.22; no executed compatibility result or sanitized receipt has
been posted. Check access
to the Windows loopback endpoint before using a container-backed client; use
a Windows-local client if that boundary cannot be reached. An RCIP bridge is
a separate feature decision and should wait for evidence from the UI experiment.
The published starter guide remains unavailable through the web reader, but the
source was reviewed at RCIP commit `e2eb619f85a287e8082dee48131188e126092522`.
The [standalone starter](https://github.com/binariedus/rcip/blob/e2eb619f85a287e8082dee48131188e126092522/templates/react-starter/src/App.tsx)
is a counter with app-owned approval, decline, and cancellation controls; it has
no Todos/Profile navigation. The separate
[pilot example](https://github.com/binariedus/rcip/blob/e2eb619f85a287e8082dee48131188e126092522/examples/pilot-web/src/App.tsx)
does contain Todos/Profile areas. Select and pin that fixture explicitly before
attempting the proposed navigation check. The guide states that its approval
button is ordinary page UI, not proof of human activation, and the starter exposes
neither a global client nor a network bridge. This is source review only, not an
executed Hronaut, Windows/Codex, or RCIP-bridge compatibility result.

The website repository's latest commit is `7b251b4`, which validates release
download links against the advertised tag. Open website issues #22 (community
hub), #5 (reviewer grants), and #2 (Search Console) remain separate work items;
their presence is not evidence of a newly reproduced website defect.

### Community release-reference consistency (September 24)

The earlier mismatch in [discussion #201](https://github.com/orgs/hronaut/discussions/201)
was resolved in the September 24, 15:26 UTC edit. A fresh read confirmed that the
welcome section, Registry version link, adapter guide, and feature summary now
consistently refer to v2.5.19. Keep these references aligned on future updates,
while preserving explicitly versioned historical demonstration claims. The
Windows/Codex React workflow remains a proposed experiment, without a new
compatibility receipt in the comments. No public discussion message was sent
during this review. The website remains at `7b251b4` with the same three open
issues.

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

Current pin review, September 24: Hronaut remains on 44.3.0. The Dependabot
configuration excludes 44.4.x because of trusted-control positioning regressions
and a 44.4.1 continuity QA crash (`1ba5514`, `d8854bc`). Do not treat the September
9 version observation above as a current latest-version recommendation.
[Hronaut #1](https://github.com/hronaut/hronaut/issues/1) is closed; its body still
contains the older 42.10.1 prerequisite text. Its desktop checklist remains
useful for future upgrades: GNOME with AppIndicator, KDE plus Xfce or Cinnamon,
icon/click/menu/attention/quit behavior, and Windows/macOS lifecycle smoke.
Dependency audit and automated Docker gates do not establish those desktop
compatibility results.

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

- The standalone recorder probe exposed a Docker/runtime mismatch: the locked
  Playwright driver was 1.63.0 while both image stages remained 1.62.1. A normal
  Chromium launch failed because the driver expected a browser absent from that
  image. Both pins now match 1.63.0, with a configuration regression that failed
  before the update and checks every pinned Playwright stage against the lockfile.
  Validate default browser launch and the full Electron/native-dialog gate in the
  updated image; the earlier explicit-browser-path probe is not that proof.

- Reproduction export had a selector-scope mismatch on pages with shadow-DOM
  components: recording validated a selector with document.querySelectorAll,
  but default Playwright locators also matched nodes in open shadow roots.
  A real Electron regression recorded a light-DOM button click and executed its
  generated action; both attempts failed with a strict-mode ambiguity before
  export retained light-DOM scope. The fixed replay clicks only the recorded
  button and still reaches the deliberate missing-assertion TODO. All three
  selector integration cases and three export unit cases pass, as do focused
  lint and typechecks. Full validation remains required. This follow-up is
  separate from the v2.5.24 candidate under verification.

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
- A four-shard Docker run of `b6d6433` failed its strict flaky-test gate because
  the Cyberpunk Turbo Home-theme poll stalled for eight seconds, then passed on
  retry. Three focused repetitions passed. This is unresolved: the failure did
  not report repeated wrong theme values, and native-view occlusion did not make
  `document.visibilityState` hidden in a diagnostic experiment. The theme test
  now attaches native Home loading state and JavaScript-read completion on
  recurrence. Do not increase the timeout or claim a visibility-event fix from
  the available evidence. The failed run also did not reach native-dialog checks.

- The subsequent DOM-recorder extraction Docker run encountered a Home onboarding
  readiness timeout and failed its strict flaky-test gate (537 passed, one
  passed only on retry); native-dialog checks did not run. Both that trace and the prior Cyberpunk Turbo trace contain
  a renderer exit with reason `crashed`, exit code 139, and WebContents ID 2.
  The onboarding trace shows one JavaScript read remaining pending until teardown,
  rather than repeated false readiness values. Existing exit records lack surface
  identity and timing, so they do not establish which renderer crashed or causality.
  The fixture now records a bounded surface category and timestamp without URLs
  or profile paths. Three focused onboarding repetitions passed with the added
  diagnostics. Investigate native crash evidence before changing timeouts.

- Home crash recovery now uses the same visible problem bar and retry action as
  website tabs. A deterministic native test failed before the fix because the
  shell excluded Home from that component. After removing the exclusion, both
  website and Home recovery tests pass; Home preserves the selected OpenCode
  client and starts a different renderer process. This fixes recovery UI, not
  the cause of the intermittent exit-139 crash. Twenty focused onboarding
  repetitions also passed without reproducing that spontaneous crash.

- The first full Home-recovery run hit `Target crashed` in the forced-kill test.
  Its exit attachment recorded only the intentional Home SIGKILL. Waiting for
  native recovery alone still produced one failure and two flaky cases in ten
  repetitions. The fixture now completes a Playwright DOM assertion on Home
  before killing it, then waits for a different, loaded native renderer before
  reading the recovered DOM. All ten subsequent repetitions passed. This
  fixture synchronization does not explain the earlier spontaneous exit 139.

- Reproduction selectors now grow until they identify the captured element
  uniquely, within a 500-character bound. The old seven-ancestor cutoff made
  repeated deep layouts ambiguous, and string slicing could truncate CSS.
  Unresolved targets remain visible in the timeline with a translated manual-step
  explanation and export as TODO actions; they are neither dropped nor merged
  across unknown inputs, and targeted keys never become global keyboard actions.
  Four regression tests failed before the fix; focused native clicks cover both
  deep repeated controls and the selector bound.

- The immutable `fa63de0` image passed all 539 Electron cases and native-dialog
  checks with no retries required. It includes Home recovery, the synchronized
  forced-crash fixture, and network waiter extraction/timing. Subsequent immutable
  images for selector changes at `a342a10` and native selection sessions at
  `6652fa5` each passed 541 Electron cases and native-dialog checks. These passes
  do not prove that the earlier spontaneous renderer crashes cannot recur.

- The immutable concurrency-fix image completed 545 Electron cases with one
  retry-only Home startup result, so the strict gate failed and native-dialog
  checks did not run. `desktop-design.e2e.ts` could not discover the Home page
  within eight seconds; its renderer-exit attachment was empty. This does not
  establish the cause or rule out an earlier unobserved renderer exit. The trace
  and native logs are preserved. Ten focused repetitions passed without changing
  the timeout. Failure diagnostics now include bounded native surface, loading,
  crash, and process state to distinguish native-page readiness from Playwright
  target discovery on a subsequent failure.

- Repeating the same Home case 25 times alongside the four-shard Docker gate
  reproduced one retry-only failure with the unchanged eight-second timeout.
  At failure teardown, Electron reported a Home web contents with loading false,
  crashed false, and a live process ID; the renderer-exit list remained empty.
  This narrows the next investigation to Playwright target discovery or URL
  tracking, but does not yet establish the cause or prove Home's DOM was usable.
  The failing trace is preserved separately from subsequent runs. A protocol
  diagnostic run is collecting target initialization evidence before changing
  application startup or weakening the test.

- The protocol diagnostic reproduced the failure once in 25 runs. Home's initial
  navigation was immediately followed by a reload while Playwright initialized
  its target. The client received an empty initial frame tree and no Home
  committed-navigation event, although Home continued fetching its dashboard.
  Native teardown again reported Home loaded and not crashed. This is stronger
  evidence of a discovery race than the previous timeout alone; it does not
  explain the older renderer exit 139 failures.
  Automatic Home refresh now waits for an in-flight main-frame load to stop,
  coalesces requests, verifies the tab and contents still belong to Home, and
  removes pending listeners on destruction. Three unit regressions failed with
  the former immediate-reload behavior; all five lifecycle cases pass after the
  change. All 25 native repetitions passed with the unchanged timeout while the
  earlier four-shard gate was still running. Focused lint and typechecking also
  passed. Full static and immutable-image verification of this change remain
  required; these repetitions do not establish that every Home failure is fixed.

- The combined Home/lifecycle/debugger-queue batch at `abfd867` passed full static
  validation: 3,240 unit/component tests across 413 files, lint, all typechecks,
  and application build. The earlier `10984ab` immutable image passed all 545
  Electron cases and native-dialog checks; its emulation/CLI batch is on main
  with passing hosted CI and CodeQL. The Home-only Docker run was deliberately
  superseded before completion by the combined 546-case image. It is not counted
  as a pass. The v2.5.24 candidate must remain unpublished until the combined
  immutable Docker gate and release-candidate static validation pass.

- The combined `abfd867` Docker image passed all 546 Electron cases and native
  dialogs; candidate `bf284bc` passed 3,240 unit/component tests and all static
  gates. Hosted v2.5.24 release run 36052676414 nevertheless failed its strict
  gate: the injected Home reload failure stalled shard 1 and passed only on
  retry. Packaging and publication were skipped; v2.5.24 was not published.
  A deterministic native test then reproduced a deferred reload exception
  escaping `did-stop-loading`, while the immediate path remained handled.
  HomeRefresh now returns a shared pending operation and the tab manager forwards
  its rejection to the existing committed-change error handler. Two unit cases
  failed before the fix; all seven now pass, including cancellation and recovery.
  Both immediate/deferred native cases and the original hosted case pass, as do
  focused lint and typechecking. The failed release tag remains immutable; a new
  release requires the final batch's full static and immutable Docker gates.

- The Playwright-aligned `c13aaf4` image passed full static validation (3,241
  tests across 414 files). Its full Electron run exposed an existing timing-only
  assertion in the post-write verification fixture: under load the 250 ms DOM
  timer finished before the first read, so a correct one-attempt result violated
  the intended multi-attempt test. Both attempts failed. The fixture now performs
  the real first read before publishing its DOM update, preserving the assertions
  for multiple reads, one write, privacy, and skipped duplicate dispatch. All five
  focused repetitions and focused static checks pass. No production verification
  timeout or retry policy changed.
