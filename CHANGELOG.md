# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Fixed

- Keep recorded iframe and open-shadow interactions as manual steps instead of exporting selectors for their outer containers.
- Avoid overlapping native thumbnail captures when the overview opens after an earlier capture times out.

## [2.5.25] - 2026-09-24

### Fixed

- Handle deferred Home refresh failures without allowing an event-handler exception to interrupt the application.
- Keep exported reproduction targets scoped to the recorded document when pages contain shadow-DOM components.

- Preserve overlapping emulation changes and finish failed updates before applying newer settings.
- Generate complete MCPB metadata when the output directory is accessed through a filesystem alias.
- Defer automatic Home refreshes until an in-flight navigation finishes, and discard refreshes for closed or replaced pages.
- Reject queued page-lifecycle commands when their target document changes before dispatch.

## [2.5.23] - 2026-09-24

### Fixed

- Reject unsupported rendering-overlay names before applying emulation settings.
- Keep performance comparisons consistent when identical emulation settings are reapplied in a different order.

## [2.5.22] - 2026-09-24

### Fixed

- Keep reproduction selectors unique on deeply nested layouts and retain unresolvable actions as explicit manual export steps.
- Show the recovery message and retry action when the Home renderer crashes.
- Keep reported network wait durations accurate when the system clock changes.
- Keep reproduction step durations and typing groups stable when the system clock changes.

## [2.5.21] - 2026-09-24

### Fixed

- Wait for an already running scroll capture before stopping a reproduction recording, preserving its final scroll step.
- Keep DOM recording state current when delayed responses arrive after navigation, tab closure, clear, stop, or restart.
- Preserve newer DOM mutation counts when an older refresh response arrives late.

## [2.5.20] - 2026-09-24

### Fixed

- Keep delayed recorder stops tied to their original recording, and preserve the final scroll when Stop is requested concurrently.
- Preserve pending reproduction and DOM recorder actions, their busy state, and their errors during automatic refreshes.
- Keep the user's newer keyboard focus choice when delayed dialog-close cleanup finishes.
- Report download destination setup failures cleanly and release reserved filenames for later downloads.
- Reject malformed diagnostic actions and modes before they can change recording state.

## [2.5.19] - 2026-09-24

### Added

- Pause and resume downloads in the current session from the Downloads panel or workspace-scoped MCP controls.

### Fixed

- Preserve the `__proto__` mock response header when adding request conditions through the UI or MCP.

## [2.5.18] - 2026-09-24

### Fixed

- Reject delayed reproduction recording starts after a newer clear, stop, restart, navigation, or tab closure.
- Release native download listeners when their controller closes or a transfer finishes.
- Reject new website and agent wallet requests once application shutdown begins.
- Cancel waiting wallet approvals during shutdown and reject transaction preparation that finishes after shutdown.

## [2.5.17] - 2026-09-24

### Fixed

- Keep resumable interrupted downloads cancellable and retain them when clearing finished downloads.
- Remove embedded HTTP credentials from history and bookmark titles even when the title's URL exceeds the storage length limits.
- Do not count an iframe's in-page navigation as another visit to its parent website.
- Expire browsing-history visits during long-running sessions and reset repeat-visit counts after the 90-day retention window.

## [2.5.16] - 2026-09-24

### Fixed

- Show the exact fork action on metadata-only workspace entries so agents can copy workspaces with direct access disabled.
- Discard cached tab overview previews as soon as a tab goes to sleep.
- Hide the release history Load more action at the supported page limit instead of leading to an invalid page.
- Close stale site controls and page panels when same-document navigation keeps the website address unchanged.

## [2.5.15] - 2026-09-24

### Added

- Show archived workspaces as metadata-only fork sources in the agent's saved workspace list, even when direct agent access is disabled.

### Fixed

- Ignore delayed native address suggestions after another browser control closes the popup.

## [2.5.14] - 2026-09-24

### Fixed

- Keep browsing-history visit counts within JavaScript's safe integer range when restoring older data and recording another visit.
- Search invalid scheme-less IP addresses and ports instead of navigating to malformed URLs.

## [2.5.13] - 2026-09-23

### Fixed

- Remove partial HTTP credentials from older bookmark fallback titles even when their saved address was already sanitized.
- Restore the newest bookmarked page when saved duplicates or an oversized bookmark file are out of order.
- Keep bookmarks to different page sections visible as distinct address suggestions, including beside a visit to the same page.

## [2.5.12] - 2026-09-23

### Added

- Show workspaces with direct agent access disabled as metadata-only fork sources in the normal agent workspace list.

### Fixed

- Preserve visit totals when older browsing-history records resolve to the same page during restoration.
- Stop reading oversized live release history responses at the size limit and cancel responses that advertise an excessive `Content-Length`.
- Keep script and style text out of generated release notes when a longer closing tag name appears, and preserve safe text after Unicode characters.
- Keep a reopened address suggestion popup visible when a delayed dismissal from an earlier native popup arrives.
- Ignore delayed clicks from an earlier suggestion popup after the same visited page or bookmark appears again.

## [2.5.11] - 2026-09-23

### Fixed

- Reject bookmark addresses whose encoded URL exceeds the storage limit instead of saving a bookmark that disappears after restart, while allowing long discarded HTTP credentials when the safe address fits.
- Ignore delayed address suggestion selections after cancelling, dismissing, or reopening the suggestion popup.

## [2.5.10] - 2026-09-23

### Added

- Let agents provide a short system notification message when requesting human attention, and mark the requested tab with a visible, accessible attention badge until the request ends.

### Fixed

- Repair older browsing-history titles truncated inside HTTP credentials after their saved URL was sanitized, keeping those credentials out of address suggestions.
- Keep visits with long discarded HTTP credentials in browsing history when the sanitized address fits its storage limit.
- Repair older browsing-history titles that still contain a URL fragment even when the saved address is already clean, so private fragments do not reappear in address suggestions.

## [2.5.9] - 2026-09-23

### Fixed

- Keep matching visited pages ahead of bookmarks in address suggestions even when a bookmark hostname matches the typed text more closely.
- Record visited pages with long discarded URL fragments in browsing history, while keeping the stored URL within its length limit after encoding. Remove fragments from URL fallback titles, including those saved by older versions.

## [2.5.8] - 2026-09-23

### Fixed

- Restore saved bookmarks in actual time order when their timestamps use different timezone offsets, keeping address suggestions correctly ordered after restart.
- Remove embedded HTTP credentials from tab titles truncated from URL fallbacks when saving or restoring active and archived tabs.

## [2.5.7] - 2026-09-23

### Changed

- Show matching previously visited pages before saved bookmarks in address-bar suggestions while typing, with the existing history and bookmark filters still available.

### Fixed

- Restore browsing-history visits in their actual time order when saved timestamps use different timezone offsets, so address suggestions stay recent-first.
- Recognize Hronaut Home by its actual internal host across browser and shell controls so lookalike addresses cannot be routed to or hidden as Home.
- Use explicit page bounds for full-page screenshots so a minimized capture cannot silently return only the viewport.

## [2.5.6] - 2026-09-22

### Fixed

- Keep bookmark and history titles from splitting a Unicode character at their length limit, and repair titles previously stored with an incomplete trailing character.
- Restore address suggestions on fresh input after their renderer exits, including when the popup was hidden, without restarting the browser or losing the typed address.
- Apply the selected interface size when address suggestions first open, keeping their text and controls consistent with the address bar.

### Changed

- Include Electron page snapshots in failed integration-test traces, initialize capture after the shell is ready, retain evidence across manual app restarts, and bound trace export so diagnostics cannot prevent application cleanup.
- Run updater compatibility checks in one isolated helper process to reduce test startup overhead without relaxing assertions or time limits.

## [2.5.5] - 2026-09-22

### Changed

- Make the vertical tab rail wait for deliberate hovering before opening, allow a short grace period before closing, and reveal immediately for keyboard focus. Keep it steady during clicks and tab drags.
- Keep Home, the labeled pin control, workspace headings, and tabs at consistent vertical positions when the rail expands or collapses, with a denser header in short windows.

### Fixed

- Prevent a direct click on a collapsed tab from selecting a different tab as the rail opens.
- Keep the rail open while either the pointer or keyboard focus is still using it.
- Preserve a deliberately scrolled tab list when the rail changes width, while still revealing newly selected or keyboard-focused tabs.
- Reserve a complete neighboring tab row when scrolling a focused vertical tab into view, preserving three readable rows in small windows at enlarged interface scales.

## [2.5.4] - 2026-09-22

### Changed

- Split the broad MCP capability test into 13 independently initialized cases, preserving its assertions while improving failure isolation and parallel test scheduling.
- Separate coverage, CPU profiling, and memory diagnostics from the browser manager while preserving debugger ownership, recording limits, and navigation checks.

### Fixed

- Preserve typed address-bar drafts when focus moves to the page or other controls, and prevent an earlier navigation completion from erasing a newer draft. Escape still restores the current address.
- Show local address suggestions without waiting for animation frames in the hidden native popup, preventing matching history or bookmarks from remaining invisible when frame delivery is suspended.
- Prioritize matching website hostnames in local address suggestions so a visited site such as Google cannot be crowded out by bookmarks or other pages mentioning its name.
- Clear Find in Page matches when the active tab navigates or reloads, discard delayed results from the previous page, and retain the query for a fresh search when reopened.
- Release Find in Page listeners and its timeout immediately when Electron rejects starting a native search.
- Show EVM and TRON token `transferFrom` source accounts in approval details, and require manual review when the source differs from the selected signer.
- Treat only exact, canonically encoded TRC20 transfers, approvals, and delegated transfers as understood operations.
- Prevent delayed Repro timeline keyboard focus from overriding a newer pointer-selected step.
- Prevent delayed Site Controls, Command Palette, and bookmark-rename completions from reopening obsolete UI or stealing focus from newer actions.
- Separate Solana legacy-provider routing from Wallet Standard payloads so website-supplied fields cannot change standard response shapes.
- Preflight every Solana batch transaction and message signer before creating approvals, preventing later invalid inputs from following earlier signing side effects.
- Route full-page captures through a temporary rendering host whenever the main window is minimized, even if the platform still reports it as visible.
- Require Solana Wallet Standard sign-and-send requests to declare the active wallet chain before transaction normalization or approval.
- Preserve wallet policy usage counters when encrypted policy removal cannot be saved, keep policy attachment changes transactional, and reject moving an existing policy identity between wallets.
- Bound wallet policy amounts and accumulated spend before arbitrary-size decimal arithmetic can stall the main process.
- Show Hronaut after a minimized sign-in launch when the system tray cannot be created, avoiding an inaccessible hidden process.
- Stop reporting a drifted Linux autostart entry as enabled when its `TryExec` points at a different application.
- Preserve empty binary fields while serializing wallet requests instead of rejecting their canonical empty base64 representation.
- Open scheme-less loopback development URLs containing a query or fragment over HTTP instead of treating them as a custom scheme or web search.
- Preserve explicit custom-protocol addresses whose payload contains a dotted name instead of rewriting them as HTTPS URLs.

## [2.5.3] - 2026-09-22

### Fixed

- Keep bounded website tab titles well-formed when the length limit lands inside a Unicode surrogate pair.
- Emit the legacy Solana `accountChanged` event with current PublicKey-compatible state so direct provider integrations cannot retain a stale account after connection or permission loss.
- Guarantee caller-initiated Solana disconnects emit `accountChanged(null)` even when their response arrives before the provider lifecycle events, without duplicating the notification when those events follow.
- Return usable copied bytes for serialized legacy Solana transaction inputs and reject malformed batch-signing responses instead of exposing invalid or proxy-wrapped typed arrays.
- Match EIP-1193 event delivery semantics for callback receivers and validation, including when wallet listeners add, remove, or register the same callback more than once during provider events.
- Keep Solana and TRON dapps bound to their previously authorized account and network even when another attached wallet sorts ahead of it, and expose only TRON's active account when other wallets are also permitted.
- Provide both Base58 and standard `41…` hex forms for the connected TRON account through the injected `tronWeb.defaultAddress` compatibility surface.
- Add configured custom Solana networks to the Wallet Standard chain metadata before exposing their accounts, preserving the required account-to-wallet chain relationship for adapters.
- Reconcile active website wallet sessions when their account permission expires, so stale EVM accounts are removed and Solana/TRON providers disconnect without waiting for another wallet mutation.
- Saturate browser-reported storage byte counts before aggregation so malformed or extreme quota data cannot leak `Infinity` or unsafe integers into Site Storage reports.
- Omit impossible completion-derived network phases and saturate extreme timing and response-byte values so out-of-order or malformed Chromium events cannot appear as valid zero-duration evidence, render as zero bytes, or expose non-finite diagnostics.
- Keep macOS startup visible when the native login-item service cannot report whether Hronaut was opened at sign-in, instead of aborting application startup.
- Reset launch-at-sign-in and minimized-launch preferences with the rest of Appearance, including removal and transactional rollback of an active packaged startup registration.
- Make Solana provider disconnects revoke the actually permitted account before session tracking and remain idempotent after every Solana wallet is removed.

## [2.5.2] - 2026-09-21

### Fixed

- Prevent delayed semantic snapshot and memory measurements from restoring or advancing obsolete baselines, and reject memory results captured across navigation.
- Keep delayed accessibility and performance baseline measurements from recreating or overwriting state after a newer clear or replacement request, and reject performance results captured across navigation.
- Keep delayed Site Storage baseline and comparison snapshots from overwriting a newer clear or request.
- Keep a delayed visual-comparison capture from recreating or overwriting state after a newer clear, baseline, or comparison request.
- Prevent delayed Repro recorder page measurements from leaking across a clear, stop, restart, or later page navigation into the wrong timeline context.
- Stop reporting malformed Linux autostart files as enabled when they omit the required application type or name.
- Advertise the injected wallet icon as a base64 image data URI so strict Solana Wallet Standard clients accept Hronaut discovery metadata.
- Treat `about:blank`, `view-source:`, and `blob:` schemes case-insensitively when enforcing restricted workspace navigation policies.

## [2.5.1] - 2026-09-21

### Changed

- Run renderer unit tests in a memory-bounded VM worker pool, preserving per-file isolation while substantially reducing repeated jsdom startup time.

### Fixed

- Avoid recording unchanged or cross-document scroll positions after reproduction-timeline clicks, removing timing-dependent phantom steps.
- Align the injected Tron provider with TIP-1193 by using official hexadecimal chain IDs, typed provider errors and disconnect payloads, ordered account state updates, and connect events.
- Disconnect active Solana and Tron provider sessions immediately when their account permission or backing wallet is removed, preventing dApps from retaining stale connected state.
- Reject an explicitly empty `HRONAUT_MCP_TOKEN` in both the desktop runtime and packaged MCPB adapter instead of silently generating a different profile token or starting an unauthenticated adapter.
- Notify Solana Wallet Standard apps when an account's chain, signing features, public key, or display metadata changes without an address change, and return a numeric EIP-1193 error for malformed request arguments.
- Explicitly terminate packaged MCP smoke-test sessions before closing their local clients so workspace write leases are released immediately during Scoop reinstall verification.
- Terminate MCPB adapter and native-dialog QA sessions before closing their HTTP transports so host disconnects release workspace write leases immediately.
- Treat Linux autostart entries with duplicate keys or repeated Desktop Entry groups as invalid instead of reporting an ambiguous launch-at-sign-in registration as enabled.
- Restore the previous runtime setting after a partially failed apply and retain both persistence and rollback failures when a transactional setting change cannot recover cleanly.

## [2.5.0] - 2026-09-21

### Added

- Add reusable browser-task definitions with redacted runtime inputs, pre-execution previews, explicit capabilities and human gates, read-only-only retry limits, exact tab/origin/control-generation bindings, typed drift outcomes, and privacy-safe task receipts.
- Add process-local, transport-bound workspace write leases with privacy-safe ownership inspection, explicit handoff, deterministic `BUSY`/`LEASE_LOST` outcomes, pause and disconnect revocation, and two-client regression coverage.
- Include privacy-safe write-lease mode, holder state, expiry, and current-owner generation in version 4 action audit receipts so handoffs and reconnects are reviewable without exposing foreign generations or MCP transport identities.
- Add a native MCP-to-WebMCP consumer bridge for QA and Complete profiles, with top-level-only discovery, bounded untrusted metadata and results, origin/navigation/runtime-bound descriptor digests, stale-tool rejection, typed unknown outcomes, and fresh page evidence after calls.
- Add an explicit external-wallet and mobile dApp QA boundary matrix with a safe local-provider handoff recipe, stage-based evidence, and negative controls that avoid credentials, funded accounts, production dApps, and compatibility overclaims.
- Add a deterministic watch-only public-address QA recipe that verifies scoped balance observation and below-UI signing rejection without importing recovery material, using real funds, or implying WalletConnect support.

### Fixed

- Bound WebMCP tool enumeration by the same operation deadline as execution and report synchronous page-callback failures as possibly effectful dispatches instead of claiming that nothing ran.
- Preserve authored reference files when rebuilding the documentation website while still removing stale generated HTML and asset bundles.
- Return the EIP-1193 disconnected error when no EVM wallet is available, keep Solana Wallet Standard account data immutable to untrusted pages, and avoid advertising signing features on watch-only Solana accounts.

## [2.4.31] - 2026-09-20

### Added

- Add privacy-bounded public-outcome receipts that compare an exact writer-context target with a distinct clean read-only observer workspace and distinguish independently visible, absent, unknown, and stale or contradictory results without enabling blind retry.

### Fixed

- Advertise Solana Wallet Standard transaction-version support so standard adapters can initialize reliably, reject non-canonical EVM chain-switch requests, and return interoperable provider errors for unsupported methods and unconfigured chains.

## [2.4.30] - 2026-09-20

### Added

- Add explicit per-tab page freeze/resume controls for deterministic QA, with observable unknown outcomes, preserved animation rates, a trusted-shell indicator, a narrowly scoped MCP tool, and a measured Electron 44 / Chromium 152 support contract.

### Fixed

- Complete EIP-1193 connect/disconnect notifications, reconcile account approval across every live same-origin provider session, and keep Solana Wallet Standard account-change events synchronized with fully resolved account state.
- Generate valid freedesktop autostart entries for unusual Linux executable paths and recognize valid registrations that use whitespace around desktop-entry separators.

## [2.4.29] - 2026-09-20

### Added

- Add cross-platform options to launch Hronaut at sign-in and keep automatic launches minimized in the system tray.
- Publish the verified official MCP Registry identity in the canonical public facts and explain that its MCPB adapter still requires a locally running Hronaut desktop app.

### Fixed

- Avoid treating a commented or unrelated Linux desktop-entry command as an active Hronaut sign-in registration.
- Derive the MCP Registry public-readback URL from the verified release metadata so identity drift cannot break an otherwise valid publication.
- Bound wallet-agent session expiry by monotonic elapsed time so an operating-system clock correction cannot extend authorization beyond its intended lifetime.

## [2.4.28] - 2026-09-20

### Added

- Publish verified MCPB release metadata to the official MCP Registry only after the GitHub release, checksums, provenance, and public website readback succeed.
- Document client network topology and loopback reachability across native, WSL, container, VM, Remote SSH, and cloud runtimes, with copy-safe failure reasons and a same-host health-to-browser preflight.

### Fixed

- Preserve task-run history and heartbeat deadlines across system-clock corrections without weakening monotonic expiry checks.
- Keep human-approval receipt timelines ordered across system-clock corrections and reject an invalid clock before changing a live review.
- Hold the Electron 44.4.x line after both released patches shifted trusted controls during compact Home navigation.

## [2.4.27] - 2026-09-19

### Fixed

- Let the release publisher find authenticated draft releases during asset reconciliation instead of stopping on GitHub's public-only tag lookup.
- Hold Electron 44.4.1 after Docker QA exposed a renderer crash and compact-navigation layout regression.
- Keep Dependabot's Playwright queue limit on its multi-ecosystem group so GitHub accepts the configuration.
- Keep Settings navigation icons out of Vue's deep reactivity path, removing avoidable render overhead and repeated development warnings.

## [2.4.26] - 2026-09-19

### Fixed

- Recover release publication safely from partial or ambiguous GitHub asset uploads by preserving verified files, bounding transient retries, and reconciling every checksum before making the draft public.
- Route MCPB users to its specific setup guide and let protected profiles pass the owner-only token file to the local adapter without exposing the raw token in Home or bundle configuration.

## [2.4.25] - 2026-09-17

### Fixed

- Preserve readable regular-file permissions when standard Linux ZIP tools extract the MCPB adapter.

## [2.4.24] - 2026-09-17

### Changed

- Correlate local wallet QA attempts across provider selection, JavaScript invocation, rejection, and independent receipt reads while keeping accounts, hashes, signing payloads, raw receipts, provider messages, and RPC URLs out of the fixture log.

## [2.4.23] - 2026-09-17

### Added

- Add copy-safe MCP readiness diagnostics to Home and the authenticated health response, separating listener health, client initialization, advertised tools, active-client visibility, and benign read-only probe evidence.

### Changed

- Make active agent work easier to notice with a faster, brighter, thicker pulse around the whole tab in horizontal, vertical, pinned, and collapsed layouts.

## [2.4.22] - 2026-09-17

### Added

- Add clean, origin-scoped `public-observer` workspaces that block page mutation tools for independent logged-out checks.
- Add an opt-in observation-quality assessment to `browser_snapshot` that stops on empty shells, login walls, human-verification challenges, soft 404s, wrong origins, missing task evidence, and structurally noisy pages before agents reason from misleading content.

### Changed

- Publish a reproducible local EVM wallet QA quickstart and clarify that the local-wallet preview has been available since Hronaut 2.4.21.
- Make agent activity easier to spot with a softly blinking outline that follows the tab shape, including pinned tabs and the collapsed sidebar, without taking space from the title. Keep the signal steady with reduced motion and describe it to screen readers.

### Fixed

- Avoid treating a meaningful article as an automated challenge solely because its title contains challenge-like wording.
- Repair clock-skewed saved-credential timestamps and keep a future-dated stale duplicate from replacing the current password.

## [2.4.21] - 2026-09-16

### Changed

- Generate bounded release-history notes in linear time so validation and release preparation stay responsive with large multibyte changelogs.
- Split hosted Electron integration coverage across five isolated runners to shorten pull-request and release feedback while retaining the complete suite.

### Fixed

- Repair malformed, future, and inverted workspace timestamps so damaged profiles or clock changes cannot keep stale workspaces incorrectly ordered on Home.
- Repair future and inverted bookmark timestamps so clock skew cannot keep stale pages permanently ahead of genuine address-bar suggestions.
- Persist repaired active and archived tab titles so oversized or control-character page metadata cannot remain in the local profile after recovery.
- Persist sanitized workspace origin metadata and malformed workspace description repairs so private URL details and invalid context cannot remain in the local profile after recovery.
- Keep Memory Saver tabs recoverable when a failed sleep transition cannot restore the page or a wake aborts before replacement navigation, instead of leaving an internal sleeping page marked awake.
- Move native focus into trusted browser chrome when Ctrl/Cmd+L is pressed from a website so typing reaches the address bar.
- Clear failed renderer-recovery markers and restore the visible page problem when Electron cannot start an unresponsive-page reload.
- Verify workspace cookie rollback and restore overwritten destination cookies even when Electron silently ignores an expiration write.
- Retry Linux page-visibility recovery when a renderer probe stalls instead of leaving that page permanently excluded from repair checks.
- Ignore native view teardown races during Linux page-visibility recovery so a destroyed view cannot stop later repair checks.
- Remove malformed HTML delimiters from published release-history notes so nested markup cannot survive the plain-text boundary.
- Fail URL waits promptly when the website renderer becomes unavailable.
- Keep partitioned cookies isolated during workspace data copies instead of widening them into unpartitioned destination cookies.
- Warn when a workspace data transfer omits partitioned cookies that Electron cannot recreate safely instead of reporting a complete transfer.

## [2.4.20] - 2026-09-16

### Fixed

- Preserve cookie and local storage changes made by destination pages while a failed workspace data copy rolls back.
- Keep page readiness waits pending when an embedded frame fails while the main document is still loading.
- Fail page readiness waits promptly when the website renderer becomes unavailable.
- Clear a previous page's favicon when a tab navigates to another page on the same website without a valid icon.
- Clear a previous page's favicon when navigation to a different main document fails.

## [2.4.19] - 2026-09-16

### Changed

- Split hosted Electron integration coverage across four isolated runners to shorten pull-request and release feedback as the suite grows.
- Show the bound browser-session generation during consequential action review and require a separate trusted confirmation that the signed-in account and visible target were verified before approving tab-bound browser actions.

### Fixed

- Repair future-dated browsing-history visits caused by clock skew so they cannot remain ahead of genuine recent visits indefinitely.

## [2.4.18] - 2026-09-16

### Fixed

- Invalidate pending browser approvals when a saved-password fill changes the username or account state but the page disables or replaces the password field before the fill can finish.

## [2.4.17] - 2026-09-16

### Fixed

- Re-read consequential-action review authority immediately before and after durable dispatch admission, closing a race where a login-session change during asynchronous validation could leave a stale approval usable.

## [2.4.16] - 2026-09-16

### Fixed

- Invalidate pending consequential browser-action reviews when an isolated workspace's cookies change, preventing an approval from surviving a silent login-session rotation or revocation.

## [2.4.15] - 2026-09-15

### Fixed

- Invalidate pending consequential browser-action reviews after a person fills a saved password, so a review cannot survive an account or login-authority change.

## [2.4.14] - 2026-09-15

### Fixed

- Preserve structured stale-observation details when a tab closes during MCP wait dispatch, including the narrow gap before the wait handler starts.

## [2.4.13] - 2026-09-15

### Fixed

- Keep Home dashboard refresh scheduling deterministic across window teardown, preventing delayed polling work from outliving its page lifecycle.

## [2.4.12] - 2026-09-15

### Fixed

- Let saved-password filling follow a newly selected or reloaded page immediately without waiting for a stale fill request, while suppressing feedback from the superseded page.

## [2.4.11] - 2026-09-15

### Fixed

- Apply a server-wide MCP tool-set change before its persisted setting becomes visible, preventing a newly connecting client from briefly receiving the previous catalog.
- Expire unattempted consequential-action reviews when their MCP session reconnects, while blocking new mutations behind an unresolved attempted review.

## [2.4.10] - 2026-09-15

### Added

- Add one versioned support, recovery, and exit guide covering supported setups, workspace backup and reset boundaries, client reconnection checks, local data recovery, and product scope.
- Compare accessibility audits against a volatile per-tab baseline, with explicit new, remaining, and resolved rule/target findings in Page tools and MCP responses.
- Review recorded reproduction steps through a keyboard-navigable timeline with a focused action, target, page, and relative-time detail view.

### Fixed

- Persist a human-decision expiry before returning it when the deadline passes during a status read, preventing restart from briefly restoring an already expired decision.
- Invalidate existing full-access MCP sessions and pending browser dispatches when the authentication mode or token changes, so approvals cannot survive credential rotation.
- Keep workspace descriptions available from workspace-header hover text without permanently taking space in the tab navigation.
- Reject accessibility and quality-audit results when their tab navigates before collection finishes, preventing stale findings from being reported for a newer page.

## [2.4.9] - 2026-09-15

### Fixed

- Align workspace name and description fields with the app's form design, keep description help below the input, and improve editor spacing and scrolling in narrow windows and at larger interface sizes.
- Show workspace descriptions beneath their names in the left navigation panel, with compact two-line previews and the full description on hover.
- Keep address-history suggestions aligned with final client-rendered page titles without counting title changes as extra visits.
- Resume live tab previews after a timed-out native capture eventually settles, without allowing unresolved captures to accumulate.
- Make workspace colors easier to distinguish in dark themes with persistent color markers, stronger container tinting and borders, and larger indicators.

## [2.4.8] - 2026-09-14

### Fixed

- Keep tab close controls available while website input is locked, including for unavailable pages being reloaded by an agent.

## [2.4.7] - 2026-09-14

### Fixed

- Load advertised favicon candidates concurrently so a stalled icon URL cannot leave a valid website icon waiting behind repeated network timeouts.

### Added

- Add provider-neutral browser reconciliation that classifies authoritative visible records before writes, binds stable item/target/source fingerprints, blocks changed or ambiguous preconditions, skips already-satisfied clicks, and preserves independent post-write verification.
- Add bounded approval groups for two to four exact, ordered browser clicks, with per-step postconditions, fresh continuation revisions, drift invalidation, and explicit review of the whole sequence.
- Add durable workspace descriptions so people and agents can record and recover each workspace's purpose, current work, and stored browser context.
- Add a runnable Docker reference for externally scheduled browser tasks, including explicit ownership, stable trigger/session identities, cancellation before dispatch, and reconciliation-safe retry rules.

## [2.4.6] - 2026-09-14

### Fixed

- Align MCPB release metadata with Hronaut's current Subscription and Trial License instead of the superseded PolyForm identifier.

### Documentation

- Add reviewed local-only directory metadata, a schema-valid Glama maintainer file, and an owner workflow for correcting misleading hosted-deployment instructions.

## [2.4.5] - 2026-09-14

### Added

- Add bounded semantic snapshot baselines and deltas for repeated agent inspection, with explicit unchanged results, complete change counts, output truncation, and stable invalidation reasons across navigation, tab, format, and workspace-control drift.
- Add an opt-in Docker browser-evaluation runner with pinned local failure scenarios and a deterministic privacy-safe evidence report.

### Changed

- Speed up repeated focused Docker integration tests by reusing content-verified Electron build output when its inputs are unchanged.
- Fan release Electron integration tests across three isolated hosted runners, preserving full coverage while reducing the release gate from one sequential suite to three concurrent partitions.

### Fixed

- Run cross-platform package candidates for actual `release/` pull requests without triggering them for unrelated branch names that happen to contain `release-`.

## [2.4.4] - 2026-09-14

### Added

- Publish a version-matched, informational operator manifest with each release so agent clients can discover supported tool sets, local prerequisites, authority boundaries, result states, and independent read-back requirements.

### Changed

- Run four local Docker integration shards by default to reduce CPU contention and avoid slower, flaky renderer startup on six-CPU Docker hosts.

### Fixed

- Verify network timing sort order without assuming a fixed-delay request must remain the slowest under heavy host load.

## [2.4.3] - 2026-09-14

### Added

- Add privacy-safe review metrics to bounded task runs, including interruptions, approvals, rejections, decision time, system-caught errors, completed tasks, and ambiguous outcomes.

### Fixed

- Move native focus from the website to the Find field when `Ctrl/Cmd+F` opens Find in page, so immediate typing enters the query.

## [2.4.1] - 2026-09-13

### Changed

- Show the bound authority generation in consequential action reviews so people can distinguish approvals created under different MCP sessions.
- Place access, workspace assignment, and automation controls in each wallet's details instead of a separate wallet settings tab.
- Keep the Wallets heading visible together with its sticky tab bar while scrolling long wallet settings.

### Fixed

- Persist website favicons even when their fetch finishes after the navigation state save, so delayed icons survive crashes and forced restarts.
- Reject a saved-password fill when that credential is updated, removed, or cleared while its secret is being decrypted.

## [2.4.0] - 2026-09-13

### Added

- Add a trusted Home action to clear an open workspace, including its tabs and isolated website data, even when website input is locked.
- Add a compact Match case option to Find in page and keep Ctrl/Cmd+F focused on the selected search text.
- Add reviewable consequential browser handoffs with privacy-safe exact-action hashes, visible workspace and capability context, cheap reject and cancel controls, single-use approval bindings, drift and reconnect invalidation, and durable attempted, verified, and unknown receipts.
- Let capability profiles restrict exact tool argument paths for tabs, wallets, recipients, targets, and payloads while persisting only canonical value hashes; delegated children can only narrow inherited constraints.

### Changed

- Organize Web3 wallet settings into Your wallets, Add wallet, Access & automation, and Activity tabs, with a selectable wallet list, focused onboarding, and explicit empty states in all seven interface languages.

### Fixed

- Restore authenticated website favicons with workspace cookies, retain them across reloads and app restarts, and recover history suggestions after their native popup is recreated.
- Coalesce repeated website wallet-connection calls into one approval so checkout flows do not fail while the first request is still active.

## [2.3.1] - 2026-09-13

### Fixed

- Show history and bookmark address suggestions reliably when typing while the suggestion popup starts.
- Display website SVG and ICO favicons across platforms, and keep tab icons when embedded frames load or navigate.
- Keep Home content width and alignment stable when switching between tabs with and without a vertical scrollbar.

## [2.3.0] - 2026-09-13

### Changed

- Home is now the workspace hub, with searchable Open and Archived views, creation, settings, templates, archive undo, and restoration. Removed the separate Workspaces button from navigation; Home returns directly to workspace management.
- Added options to hide individual workspaces from the left sidebar and protect them from permanent deletion by people or agents. Hidden workspaces remain accessible from Home; archiving, restoration, and restart retain both choices.
- Browser mute can be enabled before any website tabs exist. It persists across restart, applies to future tabs, and preserves individual tab mute preferences when switched off.
- Kept agent connection setup, activity, and the tool catalog accessible from Home, with workspace controls translated into all seven supported languages.

## [2.2.0] - 2026-09-13

### Added

- Open the new Workspaces library directly from the browser sidebar or top bar. Search workspace names and page titles, see the current workspace and access settings, and switch between Open and Archived collections.
- Open, manage, archive, restore, and delete workspaces with visible controls. Undo a workspace archive immediately; archived tabs and sign-ins stay available for later.

### Changed

- Simplify workspace creation with compact color choices and side-by-side choices for a fresh profile or copied sign-ins. Keep website restrictions, data transfers, and continuity reviews in clearly labeled expandable sections.
- Keep library search and creation controls visible while scrolling. Adapt the workspace library and editor to small windows, light and dark themes, and all seven interface languages.

## [2.1.3] - 2026-09-13

### Fixed

- Align the workspace-header divider with the navigation and Home header dividers. Keep the same border placement, thickness, and color at every interface scale.

## [2.1.2] - 2026-09-12

### Fixed

- Restore consistent buttons in What's new, Help, workspace editing, and wallet approval. Give release notes clearer headings, full-sized retry and pagination actions, readable download tables, and accessible warning colors.
- Keep docked tool headers, close buttons, and footer actions reachable in narrow panels. Reflow Network filters, Site Storage categories and editors, and tool summary cards to fit the available space.
- Improve dark-mode contrast for active page actions, storage actions, update and download indicators, and browser-tool warning and error feedback.

## [2.1.1] - 2026-09-12

### Changed

- Keep Commands, Tabs, Downloads, History, input blocking, mute all tabs, and agent following in one row of named utility icons. Place Settings directly after MCP status and retain access to every utility in narrow and short workspace rails. Give utilities their own row in smaller top-tab windows so workspace tabs remain usable.
- Use consistent button sizes, borders, icons, keyboard focus, and primary or destructive states throughout Settings, including workspace data, MCP credentials, downloads, wallets, and updates.

### Fixed

- Open the workspace editor reliably when Create workspace is selected in Settings.

## [2.1.0] - 2026-09-12

### Added

- Mute or unmute the current page directly beside the tab input lock in the navigation bar, including silent tabs. The control follows the active tab and reflects mute changes from other controls.

### Changed

- Redesign the desktop window around persistent workspaces: new profiles start with the resizable left tab rail, labeled everyday actions, and explicit new-tab actions within workspaces. Saved tab-layout choices remain available and unchanged.
- Refresh light and dark surfaces across the shell, native title bar, tabs, address bar, dialogs, and developer tools with calmer colors, clearer selection, and lighter overlays.
- Make Settings easier to navigate with a compact section list and localized search. Select a result with Enter, clear a search with Escape, and find sections by their descriptions.
- Rebuild Home into dedicated Connect an agent, Overview, and Tool library views, with a remembered selection and keyboard navigation. Keep setup and verification together; give live clients, session metrics, and recent activity their own overview; provide a searchable tool catalog with expandable descriptions.

## [2.0.0] - 2026-09-12

### Breaking changes

- Remove legacy persisted-data support: discard old base-profile browser data, active and archived workspaces without isolated storage, and tab snapshots older than version 3. Current isolated workspaces retain their identities and storage.
- Delete version-0 and version-1 wallet vaults, their pending requests, and obsolete plaintext authority files without migration. Version-2 encrypted wallets remain supported.
- Remove `fork-default`, `import-default`, `save-default`, Default-profile workspace fields, and old transfer payloads. Use `fork-workspace` with an explicit source, and human workspace-to-workspace Copy or Move controls.
- Replace legacy data management with global history clearing and workspace-scoped site storage. Ignore obsolete update settings and use Browser Essentials when no tool set is saved.

### Added

- Explain capability rejections with a bounded, privacy-safe precedence trace and stable first-denying-rule reason, keep permission separate from dispatch and postcondition state, and require every non-read MCP tool to declare its operation class explicitly.

- Distinguish successful, failed, cancelled, blocked, interrupted, verifier-rejected, timed-out, and unknown agent outcomes in the activity dashboard and task-run summaries, with privacy-safe reason provenance, dispatch state, and conservative effect certainty.

## [1.28.0] - 2026-09-12

### Added

- Allow trusted Settings to derive a narrower MCP capability credential from an active parent, with persistent parent/revision lineage, shared use limits, and immediate descendant invalidation when ancestor authority changes.
- Record bounded root-to-leaf capability profile lineage in action audit decisions without retaining bearer credentials, credential identifiers, private scope values, or tool arguments.

### Fixed

- Publish the trial and subscription distinction consistently in landing-page metadata, visible pricing FAQ content, and machine-readable product data so directories cannot infer an ongoing free plan.
- Preserve parent authorization when a derived MCP capability is edited so an update cannot silently turn it into an independent root credential.

## [1.27.0] - 2026-09-11

### Added

- Add named MCP capability profiles with one-time credential display, digest-only storage, tool and action restrictions, workspace and origin scopes, expiry and use limits, immediate revocation, and trusted Settings controls.

### Changed

- Clarify Hronaut's boundary as a local, visible MCP execution layer alongside agent frameworks in the landing page and quick start, with current trial and subscription terms.
- Add an explicit native mode for agent element clicks so custom controls can receive trusted pointer and mouse events while the virtual agent pointer remains visible.

### Fixed

- Correct the Hronaut initial in the static landing-page header mark and keep anchored section headings below its sticky navigation.
- Ignore Electron child views whose native `webContents` getter is invalidated during teardown so the Linux page-presentation recovery timer cannot raise an uncaught main-process exception.

## [1.26.1] - 2026-09-11

### Added

- Show a temporary virtual pointer for agent clicks, hovers, and drags so people can follow MCP-controlled interactions without moving the operating-system cursor.

### Fixed

- Return a stable stale-observation result when a tab closes during an MCP wait, including the brief interval before Chromium finishes removing the tab from workspace state.

## [1.26.0] - 2026-09-11

### Changed

- Replace the broad Privacy & data Settings panel with workspace-first management that lists active and archived profiles, opens per-workspace controls, and exposes the existing selective copy or archive-only move workflow; application-wide history and legacy Default-profile cleanup remain in a clearly scoped secondary section.

### Added

- Add a registry-ready MCPB adapter that connects stdio clients to the running desktop application's loopback Streamable HTTP endpoint, preserves JSON-RPC messages and session isolation, rejects remote destinations and redirects, and keeps optional bearer tokens in sensitive local configuration.

## [1.25.0] - 2026-09-11

### Added

- Extend opt-in action audit receipts with bounded diagnostic, network, DOM-change, storage-change, reproduction, and postcondition coverage metadata; available artifacts use opaque run-scoped references that reject changed control or navigation generations without copying report contents into the journal.

### Fixed

- Include the canonical public license and trial facts in clean Docker validation so release checks exercise the same tracked facts as local validation.
- Expire live audit evidence references across application restarts and report whether missing evidence came from capacity, observation, or persistence failure.

## [1.24.0] - 2026-09-11

### Security

- Bind consequential browser actions to trusted runtime origin, navigation, workspace, permission, policy, human-interaction, observation, and target facts, rejecting stale or replaced pages before dispatch with explicit retry guidance.
- Record bounded provenance rejections in private audit receipts without retaining selectors, refs, scripts, page text, entered values, credentials, paths, or raw origins.

### Documentation

- Explain why page content is untrusted input, how browser action authority is derived, and why workspace site-access policy does not provide network isolation.

## [1.23.0] - 2026-09-10

### Added

- Add a versioned canonical public-facts file, publishing checklist, and copy validator to keep pricing, licensing, platform, setup, and supported-client claims synchronized.
- Add `browser_task_runs` for durable, bounded workflow deadlines and heartbeats, with runtime-checked page, origin, and audit evidence before success and explicit blocked, timed-out, restart, or unknown outcomes.
- Let `browser_click` opt into bounded post-write verification with delayed read-back, explicit account and state predicates, durable receipt events, and conservative unknown outcomes without replaying the click.
- Add a global tab-audio control that mutes or unmutes every open website tab while preserving the existing per-tab speaker, context-menu, keyboard, and `browser_audio` controls.

### Fixed

- Pin the complete MCP tool catalog and server instructions for each live connection, so a Settings change applies only after reconnect and cannot silently alter model-facing metadata mid-session.
- Fence retained Console, Network, and in-progress download evidence by an opaque observation generation that advances on pause, reconnect, and workspace resume, preventing delayed requests, redirects, and downloads from becoming actionable after a handoff while recording the boundary in tab state and audit receipts.

## [1.22.0] - 2026-09-09

### Added

- Durable workspace human-decision records with responsible and fallback owners, bounded deadlines and notification attempts, reconnect discovery, and trusted local review controls. Acknowledgement does not resolve an unknown action outcome, replay work, or unpause agents.

### Fixed

- Keep the temporary PDF print host hidden so exporting from a tray-hidden browser does not interrupt foreground focus on Wayland.

## [1.21.0] - 2026-09-09

### Added

- Add explicit agent workspace continuity checkpoints and fresh review after pause, reconnect, or restart, with localized workspace-editor controls, continuity reports on guarded workspace resume, guarded dispatch, and separate reporting for stale observations and unknown prior outcomes.

### Changed

- Clarify full and partial refund effects on access and renewals, and default support-assisted cancellations to the end of the paid period.

### Fixed

- Avoid duplicate suggested workspace names when adding template entries after removing or renaming entries.

## [1.20.0] - 2026-09-09

### Added

- Preview, edit, import, and export portable workspace setup templates with fresh isolated profiles, explicit review, collision checks, and partial-failure cleanup. Browser sign-ins and credentials are excluded.

### Fixed

- Report retained workspace identity and cleanup guidance when initial tab creation and workspace cleanup both fail.

### Documentation

- Clarify browser versus native desktop testing scope and distinguish browser approval from downstream authorization, with disposable-fixture and synthetic policy examples.

## [1.19.1] - 2026-09-09

### Fixed

- Update Electron to 44.3.0 with upstream crash, permission-handling, and Linux sandbox tray fixes.

- Recover visible Linux pages whose compositor stops presenting frames without requiring a window resize.
- Invalidate delayed MCP results after direct human keyboard or mouse input in the target page, without requiring a pause.
- Capture background tabs outside the viewport of the existing visible browser window, avoiding a temporary window that can interrupt foreground focus on Wayland.

### Documentation

- Explain when a dedicated persistent browser profile is sufficient and when Hronaut workspaces help, with first-run persistence and visible-handoff checks.

## [1.19.0] - 2026-09-09

### Changed

- Require a paid subscription for all ongoing use after a 10-day trial starting with the first agent tool call. Enforce expiry before agent tools run, preserve manual data recovery, and limit offline paid access to seven days since validation.
- Align licensing and pricing at $4/month or $24/year per user (the annual price already includes 50% off $48), with three devices per seat. Earlier releases retain their original terms.

### Security

- Update js-yaml and Hono to patched versions identified by the production dependency audit.

## [1.18.0] - 2026-09-09

### Fixed

- Preserve uncertain write and stale observation outcomes in audit receipts after a human-agent handoff.

- Preserve bounded MCP activity history and metrics across endpoint replacement, including commands that finish after their client disconnects.

### Added

- Include active command counts and explicit unknown prior outcomes in paused MCP responses, including after client disconnects.

## [1.17.0] - 2026-09-08

### Added

- Show the number of MCP commands still settling during a pause, with guidance to inspect fresh page state before resuming.

### Fixed

- Discard workspace tool results when pause or ownership changes invalidate them while the handler runs, reporting stale observations or unknown write outcomes without returning the obsolete result.

## [1.16.0] - 2026-09-08

### Added

- Report structured snapshot completeness and search-source limits, and use measured truncation for clipboard copies, while preserving snapshot text, redaction, and workspace isolation.

### Fixed

- Recheck pause state, workspace access, and target membership after asynchronous audit admission and tab wake so stale requests cannot dispatch after control or ownership changes.

## [1.15.0] - 2026-09-08

### Added

- Add `browser_preflight` to the QA and Complete MCP tool sets for bounded workspace, origin, site-policy, and human-attention readiness checks, with explicit unverified session evidence and no automatic retries.

### Fixed

- Keep credential filling and browsing-data cleanup blocked while an MCP command is still running after its client disconnects or the endpoint is replaced.
- Suppress credential-fill success and error notifications from the previous document after a same-URL reload.

## [1.14.0] - 2026-09-08

### Added

- Opt-in workspace action audit receipts using `browser_audit_receipts` in the QA and Complete MCP tool sets, with bounded private journals, correlated site decisions, explicit partial outcomes, and sanitized JSON reports that survive reconnects.

### Fixed

- Clear stale diagnostics after same-URL reloads and prevent new DOM reads from reusing requests for the previous document, while preserving active recorders and baselines.

## [1.13.2] - 2026-09-08

### Fixed

- Ignore snapshot and PDF export feedback from a previous document after reloading the same URL, and allow a new export immediately without waiting for the older request.

## [1.13.1] - 2026-09-08

### Added

- Fork any active or archived workspace into an independent profile with copied cookies and local storage and a blank tab. Agents can discover fork sources without receiving access to the original tabs.
- Allow users to disable direct agent access per workspace while still permitting forks. The choice survives archiving and restart and blocks existing agent ownership and resume keys.
- Copy browser data between selected workspaces, or Move between archived workspaces after verifying the destination. Move checks for live pages and background site workers before starting and reports any incomplete cleanup without removing the verified destination copy.

### Changed

- Start on Home without automatically creating Default. Existing Default profiles retain their data and can be renamed, archived, restored, or deleted. Deleting the last workspace returns to Home.
- Clarify workspace creation and data transfer with explicit source, destination, data types, and Copy/Move controls.

### Fixed

- Prevent agent site-data cleanup from racing workspace copies, archiving, or deletion. Conflicting operations report that the workspace is busy before modifying data.
- Keep archived workspace metadata recoverable if creating its replacement Home view fails.
- Bound hidden storage-view initialization and scripts so a stalled renderer cannot hang a workspace transfer indefinitely.

## [1.12.3] - 2026-09-07

### Fixed

- Recover Linux pages whose native view is visible but Chromium remains hidden after presentation changes in Electron 44, without reloading the page or stealing focus.

## [1.12.2] - 2026-09-07

### Fixed

- Preserve website viewports while Settings and other full-screen dialogs are open, and restore page geometry before revealing content. This prevents one-pixel page layouts and addresses a cause of blank content requiring a window resize, including in split view.

## [1.12.0] - 2026-09-07

### Changed

- Upgrade the browser runtime to Electron 44.2.0. macOS builds now require macOS 13 Ventura or later on both Apple Silicon and Intel.

### Fixed

- Restore the browser on Linux tray left-click, including desktops where activation does not display a menu. Right-click still opens tray actions.
- Keep the selected tab visible after a resize when an older tab retains DOM focus or the browser window is unfocused.
- Prevent macOS updates from offering the new runtime to systems older than macOS 13.
- Keep active tabs clear of the trailing scroll control in narrow horizontal workspace strips while preserving separation from their sticky workspace label.
- Preserve verified text and image copying with Electron 44’s asynchronous system clipboard API, including failure reporting and recovery after rejected writes.

## [1.11.59] - 2026-09-06

### Added

- Resize split panes by dragging their divider, with keyboard adjustment and an equal-size reset. Canceled gestures restore the previous size; committed sizes survive restarts.

### Fixed

- Preserve the completed split resize when another drag starts before its acknowledgement, including cancellation of the next drag.
- Keep split pages usable when opening docked Page tools by closing the competing Split view menu.

## [1.11.57] - 2026-09-06

### Fixed

- Keep revealed workspace controls above the page in narrow windows by reserving their actual width, with a readable address row and correctly anchored suggestions.
- Keep Split view menus inside short windows, with scrollable candidates and reachable Close and Exit controls.
- Finish toolbar clicks before collapsing a focused workspace rail, so moving focus cannot shift the clicked control before mouse release.

## [1.11.56] - 2026-09-05

### Improved

- Add a quick collapse animation to the unpinned workspace panel, respecting reduced motion and keeping manual resizing immediate.

### Fixed

- Keep inactive page tools neutral so only enabled tools and capture feedback use status colors.
- Use the normal cursor over tabs, a pointer over Close, and a dragging cursor only during an actual drag.
- Show the canonical Hronaut app icon beside its title-bar name instead of a generic dashboard grid.
- Keep Settings and workspace Create/Edit dialogs open when clicking their backdrop, so outside clicks and text-selection drags do not discard unfinished workspace drafts.

## [1.11.55] - 2026-09-05

### Fixed

- Keep the Home label visible in expanded vertical rails and preserve keyboard focus when the pointer leaves the rail.
- Open detached Page Tools without a false startup failure from primary-window wallet initialization.
- Keep the software-update loading indicator visible during checks, downloads, and installation across themes.

### Improved

- Resize the workspace panel by dragging its page boundary or using the keyboard. Remember the preferred width across restarts while preserving room for the page in smaller windows.
- Suggest playful, editable names for new human-created workspaces, avoiding open and archived workspace names.
- Keep workspace names visible while scrolling vertical tabs and recover tab-list space with a compact Home/pin row and paired scroll controls. In short windows, reach tab search, history, and downloads through Commands while Settings, input lock, agent follow, and server status remain visible.
- Include bounded recent published release history in checksummed and attested release assets so the website can recover when the GitHub API is unavailable.

## [1.11.54] - 2026-09-05

### Fixed

- Keep the keyboard-focused tab or workspace control visible when the tab rail expands or resizes.
- Keep workspace tabs and page actions visible at larger interface sizes in narrow windows.
- Preserve the full selected element or rectangle in screenshots at non-default page zoom, and honor image size limits on high-DPI displays and emulated viewports.
- Detect version bumps across the complete Git push so a later commit in the same push cannot silently skip the release.
- Keep Settings actions visible in short windows at larger interface sizes, and give narrow forms enough room for their explanations and controls.

### Improved

- Add Cyberpunk Turbo with readable off-white text, selective cyan accents, magenta controls, yellow highlights, and matching Home and address suggestions.
- Sharpen the enlarged single-tab overview preview while keeping normal thumbnails compact and retaining the existing image-size limit for visually complex pages.
- Group tabs inside their workspace with a New tab action after the last tab, persistent workspace names during horizontal scrolling, and clear selection in horizontal and vertical layouts.
- Bring Home setup into view sooner with compact live status and endpoint controls, clearer client instructions, and secondary connection verification and first-task sections.
- Simplify Settings and Page Tools with quieter navigation, readable rows, and clearer actions.

## [1.11.51] - 2026-09-05

### Fixed

- Preserve the complete viewport in tab thumbnails and keep overview navigation controls at the bottom of the window.
- Keep keyboard tab activation disabled while another overview action is pending.
- Keep selected segmented controls readable when hovered.
- Preserve keyboard focus when navigation replaces a full-page preview or retry message.
- Include every page edge in bounded full-page screenshots at non-default zoom.
- Capture awake background tabs without selecting them, handle very long pages at the preview size limit, and discard captures made stale by a viewport change.
- Show unavailable status on Home when local status requests fail, and restore the current MCP status automatically after a successful refresh.
- Restore the standard button size and styling for clearing an empty Page tools search.
- Show visible, accessible retry feedback when Home cannot open an agent guide, troubleshooting, or setup feedback.

### Improved

- Inspect a tab's full page from the overview with Fit page, Fit width, refresh, and an explicit Open tab action, while preserving the live tab's viewport, scroll, and selection.
- Give small tab collections larger, centered previews and keep larger collections searchable in a stable layout.
- Guide Home setup through connecting an agent, verifying observed activity, and trying a first task, with searchable client guides, remembered guide selection, and collapsible setup and tool reference sections.

## [1.11.50] - 2026-09-04

### Fixed

- Preserve the newly selected page when a delayed tab-close request finishes or is canceled by unsaved-change protection.
- Keep newly selected network requests visible when older replays finish, and discard stale replay or content-search feedback after selection changes or clearing the log.
- Honor page beforeunload protection for human tab-close actions with a trusted, cancel-safe confirmation while keeping agent closes non-blocking.
- Redact token-like query values from IndexedDB, storage-change, cookie, code-coverage, CPU-profile, and memory diagnostic report URLs.

### Improved

- Find Page tools by name, task, or category with keyboard-friendly search, readable descriptions, and cards that adapt to the available panel width.
- Keep the public setup directory, reference, and setup-feedback client list aligned with every built-in coding-agent guide.

## [1.11.49] - 2026-09-04

### Fixed

- Keep Memory Saver from unloading unsaved drafts in valid `contenteditable` modes such as plaintext-only editing regions.
- Fill saved passwords only into visible login fields and keep username selection inside the password field's form.
- Open uppercase, mixed-case, and trailing-dot `localhost` development addresses over HTTP when their scheme is omitted.
- Rate-limit repeated failed local MCP authentication attempts without throttling authenticated agents.
- Encode dynamic page-script values defensively across credential filling, text waits, and reproduction exports.

### Improved

- Keep native interaction-lock rollback verification deterministic when page lifecycle synchronization is queued, preserving the strict no-flake release gate.

## [1.11.47] - 2026-09-04

### Improved

- Migrate the complete renderer and address-overlay styling surface to Tailwind CSS 4 composition, expose the existing theme tokens as semantic utilities, and enable the same pipeline in Storybook without applying global Preflight to Electron controls.

## [1.11.46] - 2026-09-04

### Added

- Expand the renderer UI library with semantic inputs, textareas, selects, checkboxes, switches, dialogs, menus, popovers, tabs, segmented controls, toggle buttons, tooltips, spinners, and empty states, including keyboard and accessibility contracts in Storybook and component tests.

### Improved

- Replace the temporary native button compatibility mode with an explicit application appearance, so every renderer action receives shared button state and focus behavior while established compact controls retain their intentional dimensions.
- Automatically connect shared form controls to field labels, validation messages, hints, required state, and disabled state, and adopt the form contracts in commercial-license and core settings panels.

## [1.11.45] - 2026-09-04

### Added

- Add a renderer UI component library with shared buttons, icon buttons, fields, notices, and settings rows, backed by Storybook theme/a11y coverage, CSS-token validation, and light/dark visual regression tests.
- Add first-class Zoo Code setup to Hronaut Home with global Streamable HTTP configuration, conservative approval defaults, and environment-backed authentication that keeps the owner token out of JSON.
- Add first-class Goose setup to Hronaut Home with persistent Streamable HTTP configuration, cross-platform config locations, and environment-backed authentication that keeps the owner token out of YAML.

### Improved

- Route every renderer action button through the shared UI component boundary while retaining the established behavior and styling of specialized browser controls.
- Organize the commercial-license settings slice by feature and enforce layered renderer CSS tokens with Stylelint.

## [1.11.44] - 2026-09-04

### Fixed

- Keep **Follow agents** from switching tabs while the user is editing the address bar, preserving the draft and resuming passive following after keyboard focus leaves the field.

## [1.11.43] - 2026-09-04

### Fixed

- Make **Follow agents** reveal freshly created background tabs even when their short MCP activity starts and finishes back-to-back, without waking completed sleeping-tab work or taking input focus.
- Return promptly when a workspace site-access policy blocks a redirect instead of occasionally leaving the navigation request waiting indefinitely under load.
- Refresh the packaging-only XML parser to its patched MIT-licensed release, removing the known fragment-injection advisory from the release toolchain.

### Improved

- Show **Following agents** with an explicit stop action while the mode is active, so its current state and next click are clear without relying on color alone.

## [1.11.42] - 2026-09-03

### Fixed

- Roll back in-memory wallet request creation, transitions, approvals, and cancellations when their durable atomic write fails, preventing ghost requests or unpersisted signing authority from surviving in the live process.
- Contain and visibly report wallet-request cancellation persistence failures during navigation, tab closure, and workspace closure instead of leaking an unhandled main-process rejection.
- Keep disabled or temporarily deferred **Follow agents** activity from redundantly waking sleeping tabs; the MCP operation remains the sole owner of its required page wake-up.
- Preserve every rapid **Follow agents** toggle while earlier settings writes are still pending, so a quick on-then-off gesture cannot leave following enabled.

## [1.11.41] - 2026-09-03

### Added

- Add first-class Qwen Code setup to Hronaut Home with safe authenticated and authentication-disabled HTTP MCP configurations.
- Add an independent, persisted **Follow agents** mode that passively shows the tab an agent is using, defers behind trusted Hronaut dialogs, and never takes keyboard or mouse focus.

### Fixed

- Keep local Solana and TRON transaction policies behind human approval until their RPC networks can be independently authenticated.
- Restrict public wallet approvals to requests that have reached the human-review state.
- Match Solana and TRON policy destinations case-sensitively while preserving normalized EVM address matching.
- Cancel pending wallet requests when signing keys are locked, and invalidate an in-flight signature before it can be returned or broadcast.
- Reject lossy wallet-provider payload types instead of allowing serialization to silently change an approved request.
- Focus the selected website after direct tab or Mission Control selection so immediate keyboard input reaches the page, while locked tabs keep focus in trusted chrome and agent-created tabs never steal native window focus.

## [1.11.40] - 2026-09-03

### Fixed

- Dismiss website-owned JavaScript dialogs whenever trusted Hronaut chrome covers the page, preventing a hidden site from blocking or imitating wallet approvals and other modal decisions.

### Improved

- Move active-tab cleanup and detached-panel presentation ownership out of `App.vue` into the focused active-tab feature controller.

## [1.11.39] - 2026-09-03

### Added

- Add first-class Grok Build setup to Hronaut Home, using its native local HTTP MCP transport with authentication referenced through the environment instead of copied into configuration.

### Fixed

- Ignore a delayed native address-suggestion click after the user switches tabs, preventing the stale result from navigating the newly active page and discarding its state.
- Bootstrap a live Mission Control preview when the active page's first screenshot finishes after the overview opens, without waking sleeping or never-presented background tabs.

### Improved

- Keep the authoritative sharded Docker suite deterministic under CPU contention by allowing first-instance shutdown startup enough time while still detecting an accidentally launched persistent app.

## [1.11.38] - 2026-09-03

### Improved

- Expand the visual tab overview into a near-full-window Mission Control surface and refresh last-good previews while it remains open, with bounded capture work that pauses outside the focused window and never wakes sleeping tabs.

## [1.11.37] - 2026-09-03

### Added

- Turn **Search tabs** into a searchable visual overview with workspace-grouped thumbnails, clear current-tab highlighting, keyboard navigation, and responsive layouts for crowded sessions.

### Fixed

- Keep focus and unrelated browser shortcuts behind the modal tab overview, preserve search-field caret movement and shortcut toggling, bound sparse layouts, reject malformed preview requests, and retain lock-safe tab selection.

## [1.11.36] - 2026-09-03

### Fixed

- Remove legacy **Start here** onboarding and licensing boilerplate when regenerating an existing GitHub release, keeping every release changelog focused on that version's changes.
- Move keyboard focus into a trusted modal when a background-open wallet approval, Settings window, or other Hronaut dialog becomes active, preventing hidden shell fields from retaining input.
- Restore wallet-provider access after an isolated workspace deletion rolls back, while keeping requests from the closed tab lifecycle cancelled.
- Keep a submitted address visible while a slow destination is still connecting instead of briefly clearing the address bar.
- Keep unrelated human mouse and keyboard events blocked while an agent sends an exact authorized input sequence to a locked website tab.
- Replace an existing application notification in place so rapid sequential failures never expose duplicate live alerts.
- Reject stale context-menu download actions as soon as their tab closes, even while Electron is still tearing down its page renderer.

## [1.11.35] - 2026-09-03

### Added

- Add a client-specific setup guide action to Hronaut Home for every supported coding agent, opened through a trusted Hronaut-only URL allowlist in the system browser.

### Fixed

- Require fresh trusted-dialog focus for every queued wallet approval so a repeated Enter or Space cannot approve the next request without a new review.
- Keep GitHub release-note reruns idempotent so the generated comparison section never accumulates duplicate separators.
- Recheck native window focus immediately before focusing an automatic trusted dialog so a wallet approval, Settings, or What's new prompt cannot reactivate Hronaut after the user switches to another application.
- Keep leaked commercial-license listeners inert when failed initialization cleanup also throws, preserving the real setup error and a clean retry path.
- Keep an in-flight update check or MCP Pause action authoritative and usable when automatic startup recovery retries its status subscription.
- Ignore leaked wallet listeners after failed startup cleanup so obsolete wallet state cannot repopulate Settings while the service reconnects.
- Suppress delayed credential-fill success or failure feedback after the human switches tabs or the original page navigates.
- Use the current interface language for delayed saved-password fill and removal errors instead of retaining the language active when Hronaut started.
- Cancel wallet import tokens that finish validation after the Wallets panel closes so abandoned recovery material is released from signer memory immediately.
- Show the human-readable workspace name in trusted wallet approvals, with the immutable workspace ID retained as a fallback when that workspace was removed.

### Improved

- Give the checksum manifest and every public Windows, macOS, and Linux installer a human-readable GitHub Release label while keeping updater metadata machine-readable and unchanged.
- Make installed Linux packages discoverable in GNOME and KDE launcher searches for browsers, MCP, coding agents, automation, QA, and testing.
- Reuse ESLint's content cache across hosted CI runs so small follow-up changes receive substantially faster static feedback without skipping any validation gate.

## [1.11.34] - 2026-09-02

### Fixed

- Stop a human tab close from completing after **Block input** engages while Hronaut is waking the replacement tab; agent-driven closes remain available.
- Keep leaked browser, settings, and MCP status listeners inert when failed startup cleanup also throws, preserve the original initialization error, and allow a clean retry.

### Improved

- Add a GitHub support resource that routes setup, product defects, security reports, and licensing questions to focused privacy-safe channels.

## [1.11.33] - 2026-09-02

### Added

- Add copy-ready starter workflows for authenticated handoff, localhost defect triage, and responsive review with explicit workspace and privacy boundaries.

### Fixed

- Keep trusted modal cleanup from restoring stale Hronaut focus while another application owns input, and fail closed if the native focus query is unavailable.
- Invalidate later cached changelog pages after a successful refresh so newly shifted releases cannot disappear at a page boundary.
- Ignore a leaked native update listener after failed startup cleanup so stale release state cannot overwrite a successful retry.
- Refresh transitive URI and query-string parsing dependencies to patched BSD-licensed releases after newly published host-confusion, SSRF, and denial-of-service advisories.
- Close active Chromium connections when tearing down integration HTTP fixtures so otherwise-passing Docker cases cannot spend their timeout waiting on idle sockets.
- Stop panel-dock watchers, queued layout IPC, and active resize listeners when the shell layout controller is disposed.
- Roll back page capture, export, and diagnostics resources when page-tools panel composition fails during application startup.
- Let focused static validation accept intentionally ignored documentation files without turning ESLint's ignored-file notice into a false failure.

### Improved

- Make Hronaut's published Agent Skill discoverable for authenticated browser QA, localhost and responsive testing, accessibility checks, and performance diagnosis.
- Add copyable GitHub attestation and SHA-256 verification steps for unsigned release downloads to the README.
- Serialize focused Docker dependency-cache initialization so concurrent cold starts cannot observe a partially populated cache.
- Split hosted Electron integration coverage across three balanced shards to shorten feedback while retaining all scenarios.
- Keep `App.vue` composition-focused by grouping page-tools and panel wiring, owned surface handles, and lifecycle cleanup in a dedicated controller.

## [1.11.32] - 2026-09-02

### Fixed

- Stop delayed address-navigation errors and site-summary responses from updating the shell after its navigation controller has been disposed.
- Show trusted wallet approval requests immediately for MCP agent signing and transaction operations instead of waiting for an unrelated UI refresh or window resize.
- Make the What's new Refresh action bypass its short-lived GitHub cache while retaining cached release history as an offline fallback.
- Keep generated GitHub release notes focused on version changes instead of repeating the product demo, downloads, setup clients, and license introduction.
- Prevent concurrent DOM-changes panel refreshes from leaving the trusted diagnostics UI stuck in a loading state.
- Keep release reruns from treating retained Playwright diagnostics as downloadable application assets.

## [1.11.31] - 2026-09-02

### Added

- Add a guided Home troubleshooting path that opens the MCP connection check in the system browser and offers a privacy-safe way to report unresolved setup trouble.

### Fixed

- Keep troubleshooting visible when an agent's first tool call fails, and only enable setup referrals after at least one successful agent action.
- Keep the Home success card aligned with its available feedback and recommendation actions instead of showing stale connection and licensing guidance.
- Prevent agent-driven scrolling from reclaiming keyboard or mouse focus on Linux while Hronaut is in the background, including when page input is blocked.

### Improved

- Publish human-readable titles and conservative MCP safety annotations for every tool so compatible clients can distinguish pure inspection from browser, storage, file, and wallet actions without weakening Hronaut's enforced boundaries.
- Keep `App.vue` composition-focused by moving shell interaction routing, keyboard precedence, and shortcut lifecycle handling into a dedicated controller.
- Reuse focused Docker dependency images and volumes across release-only version bumps while still invalidating the cache when dependencies, the dependency lock graph, or the test image changes.

## [1.11.30] - 2026-09-02

### Added

- After its first successful agent action, Hronaut Home can copy a privacy-safe recommendation with an attributable public link, without including browser, workspace, or agent data.

### Fixed

- Keep Hronaut from reclaiming keyboard or mouse focus when the user leaves the app during an already-running agent action, including after **Block input** is enabled.
- Prevent automatically opened trusted dialogs, including wallet approvals, from taking keyboard focus when Hronaut is in the background.
- Prevent an obsolete detached-panel open failure from redocking a newer panel selection.
- Keep the enabled workspace New Tab button, keyboard shortcut, and context-menu action usable while global page input is blocked; newly opened pages remain protected by the same lock.
- Keep trusted element and screenshot-area selection responsive on locked pages when an agent click, key press, or other input finishes while the human selection is still active.

## [1.11.29] - 2026-09-02

### Added

- After Hronaut completes its first agent tool call, Home offers a privacy-safe **Share your setup result** action that opens the existing structured GitHub feedback form in the system browser without attaching runtime data.

### Improved

- Rename the global tab-lock control to **Block input** and clarify across all supported languages that it blocks human website input and tab closing while Hronaut controls and agents keep working; foreground-focus protection remains automatic regardless of this setting.

## [1.11.28] - 2026-09-02

### Added

- Add first-class Windsurf Cascade setup on Hronaut Home, including Streamable HTTP configuration, connection verification, and owner-token file interpolation that avoids copying authentication secrets into JSON.

### Fixed

- Prevent background agent input from activating Hronaut when Electron restores the main window's focusability, including while tabs are locked on Linux desktop environments that focus a window during that transition.

## [1.11.27] - 2026-09-02

### Fixed

- Prevent background MCP JavaScript evaluations from taking keyboard or mouse focus from the application a person is using; unexpected dialogs are safely dismissed on isolated evaluations, while DevTools-open tabs retain compatible guarded evaluation.

## [1.11.26] - 2026-09-02

### Fixed

- Keep MCP `browser_evaluate` alert and confirm handling from activating Hronaut while a person works in another application, and preserve explicit accept/dismiss behavior on pages whose Content Security Policy blocks page-level `eval`.

## [1.11.25] - 2026-09-02

### Fixed

- Prevent trusted agent clicks from activating the Hronaut window while the person is working elsewhere, including when Lock Tabs temporarily permits agent input to a locked page.

## [1.11.24] - 2026-09-02

### Fixed

- Agent presentation and attention requests no longer steal keyboard or mouse focus when their target is already visible in split view.

## [1.11.23] - 2026-09-01

### Fixed

- Keep MCP `browser_show` non-activating even when Lock Tabs is off, so an agent can reveal Hronaut for observation without taking keyboard or mouse focus from the application a person is using.

## [1.11.22] - 2026-09-01

### Added

- Add trusted per-workspace Site access policies with exact origins, boundary-safe subdomain wildcards, and loopback port wildcards. Restricted policies cover direct and MCP navigation, redirects, page links and forms, popups, and back/forward history; they persist across restart and archive/restore while agents remain unable to change them.
- Add a bounded, trusted blocked-navigation log that records only origin, reason, source, and time without persisting denied paths, queries, fragments, or embedded credentials.

### Fixed

- Treat a policy-blocked redirect as an intentional cancellation instead of surfacing a generic Chromium load failure.
- Check back and forward targets before Chromium changes history so a disallowed origin cannot bypass a workspace policy.

## [1.11.21] - 2026-09-01

### Fixed

- Prevent the MCP `browser_show` tool from taking foreground keyboard or mouse focus while Lock Tabs is active; agents can still make the window visible without interrupting work in another application.

## [1.11.20] - 2026-09-01

### Fixed

- Keep Lock Tabs from moving keyboard or mouse focus into Hronaut chrome when its state changes, while retaining the native input barrier that blocks physical interaction with locked website pages.
- Reject credential-bearing HTTP(S), `view-source:`, and origin-bound `blob:` URLs across agent workspace navigation so embedded usernames or passwords cannot enter live tabs through direct commands, redirects, or website popups.

### Improved

- Make release auto-tagging idempotent when a matching signed tag is published concurrently, while still failing closed if the remote tag points at another commit.

## [1.11.19] - 2026-09-01

### Fixed

- Block local-file and privileged/internal-scheme navigation in agent-owned workspace tabs, including direct commands, redirects, popups, and restored profile state, so MCP browser access cannot become an unrestricted local-content viewer. Existing unsafe persisted tabs are repaired to blank documents without preventing startup. Normal web, embedded QA, and origin-bound blob documents remain supported; the explicit file-upload tool still attaches agent-supplied local paths only to website file inputs.

## [1.11.18] - 2026-09-01

### Fixed

- Preserve the human's active window and trusted-chrome focus across agent clicks, typing, and key presses, including when page input is locked, so background MCP work cannot reactivate Hronaut and capture physical keyboard or mouse input.

## [1.11.17] - 2026-09-01

### Fixed

- Keep trusted wallet approvals above website content even when a delayed shell measurement arrives, so connection, signing, and transaction confirmations no longer appear only after resizing the window.
- Point the desktop repository's static reference site at the canonical Hronaut storefront and provide complete large-card Open Graph metadata instead of identifying GitHub as the shared page.

### Improved

- Keep the reference site's appearance copy aligned with all eight built-in palettes plus System mode.

## [1.11.16] - 2026-09-01

### Fixed

- Keep Wallet Standard `silent` and legacy `onlyIfTrusted` Solana reconnect checks from opening trusted approval UI before a site has address permission.
- Support the `off` event-listener cleanup used by maintained Solana wallet adapters so disconnecting cannot stall before Hronaut receives the request.
- Wait for the persisted tray-close preference before exercising process shutdown in release validation, removing a race that could leave the test app hidden in the tray and block otherwise valid packages.
- Shut down wallet brokers before deleting their temporary vaults in unit tests so background confirmation and audit work cannot race test cleanup on slower runners.

## [1.11.15] - 2026-09-01

### Release status

- Not published: release validation detected a wallet broker teardown race before any binaries were built. The fixes are included in 1.11.16.

## [1.11.14] - 2026-09-01

### Release status

- Not published: release validation detected a flaky tray-close test before any binaries were built. The fixes are included in 1.11.15.

## [1.11.13] - 2026-09-01

### Fixed

- Publish legacy Solana `publicKey` and connection state after selecting Hronaut so compatible dapps stop waiting and can continue to their trusted approval flow.
- Dispatch agent keyboard shortcuts through Chromium's awaited input channel so background-focus races cannot report a successful key press that the page never received.

## [1.11.12] - 2026-09-01

### Fixed

- Hide native website views while trusted Hronaut dialogs are open so wallet approvals appear immediately after a dapp selects Hronaut, without requiring a window resize, and restore the page between consecutive requests.

## [1.11.11] - 2026-09-01

### Changed

- Clarify Wallets onboarding with descriptive Generate, Import, and Watch-only choices, outcome-specific actions, a distinct wallet-management state, signing-key controls only when a signing wallet exists, and an automatic handoff to the newly added wallet without leaving duplicate-ready form values behind.

### Fixed

- Reveal the GitHub-backed **What's new** reader immediately above normal website content without requiring a window resize, including at the minimum supported window size.
- Refresh Responsive Preview controls from the applied tab viewport after closing and reopening during a pending Apply, without letting an older failure overwrite a newer draft.
- Reveal trusted wallet connection and signing approvals immediately above website content without requiring a window resize, and keep approval actions visible while reviewing long requests.
- Refresh Environment controls from authoritative tab state when a pending Apply finishes across close and reopen cycles, without letting an older failure overwrite a newer draft.
- Keep the Workspace editor visible and clearly busy while saving, closing, or copying browser data; block every dismissal and conflicting edit path until the authoritative operation finishes.
- Keep validated wallet imports visible and immutable until trusted cancellation finishes, preventing a stale cancellation from colliding with a newer onboarding attempt.
- Keep wallet rename and RPC drafts open for retry when persistence fails, prevent conflicting inline editors, and lock drafts while their update is in flight.
- Keep transaction-automation drafts scoped to the selected signing wallet, clear successful policy forms to prevent accidental duplicates, and reject misleading bounded automation policies for watch-only wallets.
- Cancel validated wallet imports when the trusted Wallets panel closes or changes sections so abandoned recovery material is removed from signer memory immediately instead of waiting for expiry.
- Let hidden full-page screenshots use Chromium's own capture presentation path instead of waiting on an unrelated compositor subscription that can be missed under load.

## [1.11.10] - 2026-09-01

### Fixed

- Send a plain-data wallet import confirmation through Electron IPC so validated mnemonic and private-key imports can be encrypted instead of failing with a data-clone error.

### Improved

- Make wallet imports a clear two-step flow that moves focus to a public-details review, explains when local encryption occurs, shows workspace access, and provides an explicit **Add encrypted wallet** action.

## [1.11.9] - 2026-08-31

### Fixed

- Keep every trusted Settings descendant outside title-bar drag regions so Wallet form fields and selectors remain interactive after locking and unlocking tabs.

## [1.11.8] - 2026-08-31

### Fixed

- Return the canonical cancellation result when wallet removal races request preparation, instead of exposing an internal approval-state transition error to the website provider.

## [1.11.7] - 2026-08-31

### Added

- Add a privacy-safe general bug-report form with reproducibility fields and explicit guidance to keep browser, wallet, and MCP secrets out of public issues.

### Improved

- Restyle the GitHub-backed **What's new** history as a compact release reader with date/version headers, denser categorized notes, and a narrower scrollable dialog.

### Fixed

- Drain queued bookmark, credential, site-permission, and commercial-license writes during shutdown so recent changes are not lost when Hronaut quits immediately after an action.
- Keep a newer wallet-vault lock or application shutdown authoritative when an asynchronous unlock is still waiting on the operating-system credential store, preventing stale completion from restoring decrypted key material.
- Restore the cached What's new history to a ready state when its dialog closes during a refresh, instead of leaving the controller permanently marked as loading.

## [1.11.6] - 2026-08-31

### Changed

- Add a three-step first-run path, workflow links, platform/CI badges, and machine-readable package discovery metadata to make the public repository easier to evaluate and adopt, and send first-time downloads through the curated OS/package chooser instead of GitHub's raw asset list.
- Link future unsigned-package release warnings directly to the SHA-256 and GitHub attestation verification guide.

### Fixed

- Drain queued browsing-history writes during shutdown so the final visit is not lost when Hronaut quits immediately after navigation.
- Hand the GitHub-backed **What's new** view off from Settings and About instead of stacking multiple `aria-modal` dialogs, keeping focus and assistive-technology semantics on one trusted surface.
- Treat **What's new** as a real keyboard modal so Escape closes it and application shortcuts cannot execute behind it.
- Keep older stable releases reachable when a GitHub history page contains only filtered prereleases.
- Repair the public security-policy link and guard repository-relative README links against future 404s.

## [1.11.5] - 2026-08-31

### Added

- Add a trusted, paginated **What's new** view in About and Software updates that renders sanitized notes from GitHub Releases, keeps GitHub as the single source of truth, and retains recently loaded history when the network is temporarily unavailable.

## [1.11.4] - 2026-08-31

### Fixed

- Disable configured-wallet mutations while another wallet operation is still refreshing, preventing a fast second click from being silently discarded.

## [1.11.3] - 2026-08-31

### Fixed

- Close Chromium keep-alive connections before local HTTP fixture teardown in long Electron shards, preventing completed shell tests from exhausting the global timeout during cleanup.
- Keep EIP-1193 accounts scoped to the active chain, switch among configured workspace networks with the required provider events, route signing to the requested permitted account, and notify connected dapps when account access changes after vault locking, permission revocation, wallet removal, or network fallback.
- Drive wallet-request expiry regression timing with a controlled clock so loaded CI runners cannot let the fixture expire before the test captures it.
- Scope native input-guard failure injection to the lock operation under test so background debugger synchronization cannot consume the one-shot failure on loaded CI runners.

## [1.11.0] - 2026-08-31

### Added

- Add chain-aware wallet onboarding with curated EVM, Solana, and TRON network presets, editable RPC endpoints, a full custom-network path, and explicit public-RPC/mainnet safety guidance.
- Let each wallet use either an explicit workspace allowlist or an opt-in **Any workspace** scope that also covers future workspaces, without granting address or signing permission.
- Let a dedicated EVM agent wallet opt into a short-lived, fully bounded **Bypass Approve** policy for exact mainnet agent transactions, while websites and requests outside the delegation still require trusted approval.

### Fixed

- Explain wallet-vault locking in context, make it reliably clear OS-protected signing keys from memory, and provide a system-secure-storage unlock path without requesting an irrelevant passphrase.
- Switch wallet imports between a mnemonic phrase textarea and a masked private-key field, clearing any entered secret when the format changes.
- Let configured wallets replace a failed or rate-limited RPC endpoint without recreating their signing identity, while cancelling pending requests and removing endpoint-bound automatic policies.
- Replace Electron's unsupported wallet-rename prompt with an inline trusted editor, and add accessible labels to vault passphrase controls.
- Require an explicit saved workspace selection for bounded wallet policies, preventing policies from silently targeting the first attached workspace.
- Keep bounded-policy submission disabled until its origin, destination, method, limits, expiry, and operation count are valid.
- Validate trimmed custom network identifiers, names, and HTTP(S) RPC URLs before wallet submission, while accepting harmless surrounding whitespace in EVM chain IDs.
- Return a normal validation error for partially typed or malformed wallet RPC URLs instead of letting URL parsing throw from the shared schema.
- Show public-RPC rate-limit guidance only for presets that actually use a public endpoint, not local or custom networks.
- Revalidate automatic-policy expiry and mainnet Bypass Approve invariants at the final serialized signing boundary, preventing a queued transaction from signing after its delegation expires.
- Scope active and archived MCP workspaces to the creating connection, hide other clients' identifiers and label collisions, preserve workspace identity through archive recovery, return a private cleanup capability for retained failed forks, and require that capability before a reconnect can recover persistent browsing state.
- Require human approval for Solana and TRON public-testnet signing until their RPC endpoints can be independently attested, preventing a retained testnet label paired with a mainnet RPC from authorizing automatic transactions.
- Validate custom EVM chain IDs inline and in every trusted wallet-creation path, preventing malformed or unsafe IDs from being persisted and failing later during RPC operations.
- Keep configured wallet RPC endpoints, embedded transport credentials, raw adapter failures, and simulation logs out of MCP responses and durable approval state.
- Keep EVM, Solana, and TRON network identity fields synchronized when switching chains instead of retaining incompatible IDs and endpoints from the previous family.
- Freeze validated import details until confirmation or cancellation so a prepared secret cannot be saved with another chain family's network metadata.
- Keep new-wallet workspace choices independent from the configured-wallet access editor.
- Keep the selected settings section visible at narrow window sizes by using a compact horizontally scrollable navigation strip.
- Route ordinary vertical mouse-wheel input through the responsive Settings section rail without trapping page scroll at either boundary.
- Replace stale Scroll and Celo testnet RPC presets, correct Sonic Testnet's chain ID, and remove the deprecated Taiko Hekla preset.
- Publish message-signing approvals only after their simulation audit is durable, closing a permission-revocation race exposed by hosted CI.

## [1.10.1] - 2026-08-31

### Fixed

- Keep the trusted Settings surface outside Electron title-bar drag regions so wallet names, native selectors, and other controls remain interactive across tab layouts, locked pages, and scaled interfaces.
- Prepare the packaged Windows profile with the Complete MCP tool set before exercising persistence, so the Scoop install smoke verifies its intended `browser_evaluate` workflow instead of failing against the new Browser Essentials default.

## [1.10.0] - 2026-08-30

### Added

- Add profile-wide Browser Essentials, Web QA, and Complete MCP tool sets, with localized Settings controls and deterministic catalogs for every connected client.
- Add local, encrypted EVM, Solana, and Tron wallets with generated, imported, watch-only, and dedicated-agent records; workspace/origin permissions; trusted approval; simulation; bounded local/testnet policy automation; and hash-chained non-secret audit history.
- Add standards-oriented EIP-1193/EIP-6963, Solana Wallet Standard, and TIP-6963 website providers, plus narrowly scoped MCP wallet list, balance, prepare, request, status, and cancellation tools that never expose or approve secrets.

### Changed

- Keep `App.vue` composition-focused by moving tab search, find, zoom, browser collections, workspace editing, credential selection, and the command palette into one focused transient shell layer with a narrow imperative surface.
- Keep `App.vue` composition-focused by moving Settings, trusted wallet approval, and Help mounting into a dedicated dialog layer with explicit controller contracts.
- Keep Hronaut Home aligned with the public client matrix by adding profile-aware Kiro, Mistral Vibe, and Warp setup guides, including environment-backed credentials where those clients support them.
- Parallelize standalone incremental typechecks with a constrained-runner override, run release validation concurrently, and stop repeating successful type analysis in dependent platform packaging jobs.
- Run the two hosted Electron shards on isolated runners and record Playwright traces only on a strict first retry, shortening successful Docker gates without accepting flaky tests.
- Add a warm full-suite Docker preflight that reuses lock-keyed dependencies, skips duplicate type analysis, and runs the complete Electron and native-dialog suite across six local shards while preserving the immutable authoritative gate and two-shard hosted profile.
- Add a focused static validation command that runs content-cached ESLint concurrently with only the incremental TypeScript projects affected by the edited files, and include website TypeScript in both focused and full lint coverage.
- Synchronize physical X11 pointer and wheel delivery in Docker interaction-lock QA so concurrent Electron shards cannot mistake an undelivered probe for a still-locked page.
- Keep setup feedback and generated release guidance aligned with all fourteen focused coding-agent guides, so users can identify their actual client instead of falling back to a generic category.
- Link every focused coding-agent setup guide from the GitHub README so visitors can move directly from their client to the local Hronaut connection flow.
- Avoid repeating the full TypeScript analysis inside hosted Docker integration after the parallel validation job has already run it, while retaining typechecking in standalone Docker runs.
- Keep Docker's dependency layer keyed to the lockfile instead of unrelated package-script metadata, build the application once, and run the authoritative Electron suite across isolated Xvfb and MCP-port shards; focused Electron feedback also skips duplicate type analysis, targeted TypeScript and lint commands avoid unrelated work, and full lint uses a content-addressed cache.
- Reuse lock-keyed focused Docker dependency volumes, cap CI Vitest projects at two isolated fork workers, and provide an incremental full-project typecheck for faster repeated feedback without weakening the clean full gates.
- Start new profiles with the smaller Browser Essentials catalog while preserving the Complete catalog for existing profiles.
- Keep wallet keys and pending signable message bodies in trusted main-process memory only, encrypt managed records with XChaCha20-Poly1305, wrap the vault key with secure operating-system storage, and require Argon2id passphrase protection when Linux reports `basic_text` or no secure secret backend.
- Use the MIT-licensed RustCrypto Argon2id Node-API binding for the Linux passphrase fallback so the vault works in Electron runtimes that do not compile Node's optional Argon2 API.
- Clarify when Hronaut's persistent local browser model fits better than disposable or hosted automation, and document the Web3 trust model, mainnet approval boundary, and testnet automation limits.

### Fixed

- End a missed hidden-page frame subscription before probing readiness with Electron's independent page capture, preventing tray screenshots from timing out under concurrent renderer load.
- Roll back per-tab and global interaction-lock state when Chromium rejects a native input-guard update, including actively removing a partially applied compositor lock so websites cannot remain frozen behind an unlocked UI.
- Clean every wallet startup listener when initialization fails, preserving the source failure alongside any cleanup errors instead of leaking later listeners or masking the cause.
- Subscribe to wallet-service events before reading startup snapshots, preventing status, account, and approval changes during Settings bootstrap from being lost.
- Keep live wallet status and descriptor events authoritative over delayed post-operation snapshots, and stop refresh work cleanly when Settings disposes its wallet controller.
- Keep live wallet-request events authoritative over delayed Settings refreshes, preventing cancelled or expired approvals from reappearing and ensuring overlapping refreshes cannot restore older state.
- Keep trusted browser shortcuts available when only the focused website tab is interaction-locked, while continuing to block page keyboard input and global-lock tab closure.
- Replace the obsolete external-wallet proposal and its broken design-document link in the detailed reference with the implemented local EVM, Solana, and Tron wallet trust model and canonical security documentation.
- Verify Tron transaction JSON against its canonical protobuf bytes and transaction hash at normalization, simulation, signing, and broadcast boundaries, preventing substituted or post-approval-mutated data from being signed.
- Reject negative or unsafe EVM chain IDs and transaction nonces outside JavaScript's safe integer range instead of accepting invalid networks or silently rounding values before simulation, approval, and signing.
- Make MCP `browser_press` insert the intended shifted printable character, so combinations such as `Shift+x`, `Shift+1`, and `Shift+/` produce `X`, `!`, and `?` instead of their unshifted text.
- Store managed wallet descriptors, permissions, policies, and durable automation counters in one encrypted authenticated vault authority state; require a one-shot current-process authorization before key release; reject managed/watch-only identity collisions; migrate legacy plaintext authority by revoking grants and converting bounded automation to Always ask; and prevent an in-flight automatic request from signing after its selected policy is removed or tightened.
- Keep Home, normal browsing, tray, and non-wallet MCP tools available when wallet metadata is malformed or encrypted vault records fail authentication; disable wallet operations with a sanitized failure state, preserve damaged files for recovery, authenticate every encrypted record before reporting the vault ready, and survive Linux keyring availability changes without misclassifying valid passphrase vaults.
- Prevent physical mouse-wheel and compositor scrolling from bypassing per-tab or global website interaction locks, while keeping keyboard shortcuts, Hronaut Home, and trusted agent scrolling available.
- Give hidden tray screenshots enough bounded time to acquire a Chromium compositor frame under concurrent renderer load, while letting PDF export use Electron's independent print pipeline instead of waiting on a frame it does not consume.
- Drain in-flight wallet confirmation and audit work within a bounded shutdown window before locking the vault, preserve unresolved submitted transactions for restart recovery, and stop confirmation or expiry timers from racing disposed wallet state.
- Treat a tab closed during address navigation as a cancelled request instead of showing a false navigation failure after its replacement tab is active.
- Keep concurrent static validation from racing ESLint against Electron Vite's short-lived generated config bundle.
- Reject secret-bearing wallet payloads at every supported nesting level, fail closed when public/provider input exceeds the shared serialization depth, and reject oversized or sparse arrays, shared-reference graphs, and over-budget binary views before expansion, preventing deeply nested secrets and payload-amplification denial of service from reaching the trusted wallet broker.
- Give the theme picker proper radio-group keyboard behavior with one Tab stop plus wrapping Arrow, Home, and End navigation across all regular and expressive themes.
- Treat a sleeping tab closed during restoration as a cancelled selection instead of surfacing a false destroyed-renderer error after the healthy fallback tab is already active.
- Expose each workspace tablist's actual horizontal or vertical orientation to assistive technology so screen-reader guidance matches its arrow-key behavior.
- Speed up repeat validation with cached incremental typechecking, concurrent static gates, tunable Vitest workers, balanced four-way local Docker Electron sharding, and a resource-safe two-shard hosted CI profile.
- Trap keyboard focus inside trusted wallet approvals so a newly presented request cannot leave typing or tab navigation in the underlying website.
- Preserve Page Tools and other shell panels when the global interaction lock blocks a Developer Tools shortcut.
- Invalidate wallet request contexts synchronously on page navigation or tab closure and roll back overtaken account grants, preventing delayed preparation or permission persistence from authorizing a page that is no longer active.
- Preserve the wallet security guide when rebuilding the generated website output instead of deleting it during output cleanup.
- Bind wallet authorization sessions to server-issued MCP transport sessions, preventing another client from reusing a disclosed wallet session token even when both clients present the same User-Agent, removing terminated clients from live dashboard state, and keeping live MCP tool-set changes effective for connected clients.
- Drain and revoke in-flight agent wallet operations before MCP session termination or application shutdown completes, preventing late approval creation or bounded testnet signing after the requester has gone away.
- Keep wallet and tab lifecycle authorities available until MCP shutdown has durably cancelled agent approvals, so a clean application exit cannot leave them awaiting human action.
- Wait for MCP wallet-session request cancellation during listener shutdown, and contain cancellation failures instead of leaving cleanup in flight or producing an unhandled rejection.
- Bind EVM approvals to a fully prepared transaction, including nonce, gas, fee fields, and normalized transaction type, before signing.
- Keep mislabeled mainnets and unknown networks out of bounded automation even when their saved environment claims to be a testnet or local chain.
- Show trusted approval UI the exact canonical message or typed data while keeping message bodies out of durable records and agent responses.
- Reject forged wallet JSON type tags and prototype-like keys, return standards-shaped EIP-1193 errors, and present wallet-vault security states without leaking internal enum values.
- Remove horizontal crowded-tab scroll controls as soon as the tabs fit the full strip again, and keep the Home loading indicator visible in compact and collapsed layouts.
- Stop native tray attention when its requested tab or workspace closes instead of leaving a stale pulsing request behind.
- Let agents show Hronaut or request human attention before their workspace contains a browser tab, while keeping pending tabless requests visible only to their originating workspace.
- Authenticate and validate request origins before parsing MCP JSON bodies, so unauthorized malformed or oversized payloads cannot consume the parser first.
- Cancel and reject live wallet requests when a wallet is detached or removed, its account permission is revoked, or its website renderer is destroyed; clear retained message bytes and revalidate attachment and permission immediately before signing.
- Automatically zero and discard unconfirmed imported wallet secrets when their five-minute confirmation window expires, even while Settings remains idle.
- Remove a wallet's bounded automation policies when it is detached from their workspace, preventing old authorization from silently returning after a later reattachment.
- Reject expired wallet policies and path-bearing policy URLs before persistence, keeping bounded automation tied to exact HTTP or HTTPS origins that can actually match requests.
- Roll back newly generated wallets when recovery confirmation is declined or fails, instead of retaining an unusable account whose recovery phrase cannot be shown again.
- Scope Solana disconnect to the selected wallet and requesting site, cancel its pending signatures, and preserve unrelated same-origin chain permissions.
- Expire untouched wallet approval requests at their deadline, reject the waiting website caller, and clear retained message bytes without requiring a click or restart.
- Fail wallet request preparation closed so connection, transaction, and message setup errors cannot leave stale requests available for approval.
- Always settle wallet callers and clear retained message bytes after approval, rejection, cancellation, revocation, or expiry, even when audit persistence fails after the terminal state change.
- Keep polling submitted wallet transactions until confirmation becomes terminal, resume confirmation tracking after restart, and record submission and confirmation in the immutable audit history.
- Keep MCP wallet addresses hidden from request-status and cancellation responses until account permission is active, and bind those operations to the exact page origin and navigation that created the request.
- Keep Repro recorder copy confirmation visible when a background recording refresh arrives immediately after the clipboard write.
- Keep the packaged MCP smoke aligned with the Complete tool catalog it verifies after new profiles began defaulting to Browser Essentials.

## [1.9.11] - 2026-08-28

### Changed

- Add a focused Docker/Vitest command for fast file- or case-level unit and component feedback without building or launching Electron.

### Fixed

- Treat Electron's aborted page loads as normal navigation supersession and keep stale address submissions from showing a false failure over the newer page.
- Keep delayed native workspace-editor requests from opening over a newer Settings, Help, Command Palette, or credential dialog.
- Keep keyboard and programmatic focus inside the active Hronaut modal, including reverse tabbing at the minimum window size and 125% interface scale.
- Keep the current page visible when closing it would require a sleeping replacement that cannot wake, and preserve newer tab selections while replacement restoration is pending.
- Keep the active split-view pane attached and visible when its inactive partner closes.
- Add credential-free one-click VS Code MCP setup from Hronaut Home while retaining manual setup for authenticated profiles.
- Recover Hronaut Home endpoint and client setup instructions after committed MCP or language changes even when the main-process reload fails.

## [1.9.10] - 2026-08-28

### Changed

- Move the browser tabs, title-bar surfaces, navigation controls, and page actions into a focused presentation layer while keeping application orchestration in `App.vue`.
- Speed up focused Docker/Xvfb regression runs by reusing a dependency-only image layer and bind-mounting the live checkout, while keeping the full immutable-image Docker suite as the delivery gate.

### Fixed

- Serialize native website permission prompts and revalidate queued requests before showing them.
- Preserve MCP download ownership when an archived workspace is reopened with a new workspace ID.
- Wait for in-flight workspace storage changes to finish before flushing browser profiles during shutdown.
- Let the release workflow advance the last verified Scoop manifest only after new artifacts and checksums exist, instead of blocking artifact creation on a future manifest.
- Retry transient Chromium profile-directory cleanup races in Electron integration fixtures.

## [1.9.9] - 2026-08-28

### Added

- Add a focused Docker/Xvfb Playwright command for fast file- or test-level regression feedback while keeping the full Docker suite as the delivery gate.
- Add a portable Hronaut Agent Skill for safe workspace creation, semantic browser interaction, and human handoff across skill-aware coding clients.

### Changed

- Move the page-tools and developer-panel presentation layer out of `App.vue` while preserving its controller-owned panel models and imperative handles.

### Fixed

- Keep the native Pick Element action from starting a hidden website picker behind command-palette, workspace, credential, Help, and Settings modals.
- Preserve newer human tab selections while MCP wakes a sleeping selection target, and close sleeping MCP tabs without reloading them first.
- Attribute MCP activity to the validated tab in the requested workspace, including while an omitted-target command wakes a sleeping tab.
- Keep the native Command Palette action from opening behind workspace and credential modals, so the visible dialog remains authoritative for Escape and focus handling.
- Preserve the existing browser session when Hronaut receives a quit request before cold-start tab restoration begins, instead of flushing an uninitialized empty model over `tabs.json`.
- Keep detached tool-panel switches exclusive, preserve newer user selections and close actions over queued native presentations, and keep automatic refresh bookkeeping from cancelling a newer native request.
- Wait for sleeping tabs to wake successfully before presenting them from tray and MCP attention actions, preserving the current visible tab when restoration fails.

## [1.9.8] - 2026-08-28

### Fixed

- Keep a focused address-bar selection authoritative while an earlier navigation commits, so rapid consecutive searches cannot append the new query to a redirected page URL.
- Keep Hronaut Home controls interactive while the global website-tab interaction lock is enabled.

## [1.9.7] - 2026-08-28

### Changed

- Move Downloads, Bookmarks, and History panel rendering out of `App.vue` into a focused browser-collections layer while preserving controller-owned panel refs and models.
- Consolidate active-tab presentation, origin-scoped credential filling, emulation labels, and detached-panel state behind a focused feature controller, keeping `App.vue` composition-focused.
- Extract active-tab derivation, diagnostic-log preservation, and MCP tab-activity composition from `App.vue` into a focused runtime feature controller.
- Extract full-modal state, shell geometry, and competing-overlay coordination from `App.vue` into a focused layout feature controller.
- Extract shell appearance, custom title-bar, detached-panel, tab-rail, and panel-dock presentation composition from `App.vue` into a focused feature controller.
- Extract startup task aggregation, bounded recovery, and coordinated teardown from `App.vue` into a focused feature controller.
- Update the embedded accessibility and performance audit engines to axe-core 4.13.0 and web-vitals 6.2.1.

### Fixed

- Persist profile state through one exclusive randomized atomic-file writer, preventing predictable temp-file symlinks from redirecting credentials, license data, tabs, settings, permissions, history, bookmarks, or window-state writes onto unrelated user files.
- Prefix Windows reserved device names suggested by websites before allocating download paths, while preserving normal filenames and collision-safe numbering.
- Search scheme-less email-shaped address-bar input instead of interpreting it as URL credentials, while preserving `@` characters in valid URL paths.
- Reject Windows reserved device names for requested PDF and sanitized HAR exports, and prefix title-derived reserved names so generated files remain portable across supported platforms.
- Bind native website-permission prompts to the exact requesting frame, preserving valid cross-origin iframe grants while rejecting late decisions after frame or tab navigation and destruction.
- Strip embedded HTTP credentials from bookmark and visit-history fallback titles, and repair existing credential-bearing history records instead of dropping them.
- Keep MCP download history, save paths, cancellation, and clearing isolated to the agent workspace that created each download.
- Strip embedded HTTP credentials from active and archived tab URLs before persistence, and repair credential-bearing profile state during startup.
- Recover from malformed profile MCP token files by generating one new owner-only token instead of leaving Hronaut running without a window or MCP listener.
- Keep simultaneous same-named website downloads in distinct collision-safe files instead of silently overwriting one response.

## [1.9.6] - 2026-08-28

### Added

- Add localized, profile-aware Zed setup to Hronaut Home with its remote `context_servers` schema, explicit non-OAuth marker for unprotected profiles, and live status verification.
- Add localized, profile-aware Devin Local setup to Hronaut Home with current user-scoped configuration, owner-token file interpolation, and connection verification commands.
- Add localized, profile-aware JetBrains Junie setup to Hronaut Home using the user-level MCP configuration shared by Junie CLI and JetBrains IDEs.
- Add localized, profile-aware Kilo Code setup to Hronaut Home with trusted token-file references and a connection verification command.
- Add localized, profile-aware Cline setup to Hronaut Home with explicit Streamable HTTP configuration, authentication-aware headers, approval-safe defaults, and a connection verification command.

### Changed

- Extract workspace-editor visibility and create, edit, and close routing from `App.vue` into a focused shell controller.
- Refresh patch-level application dependencies and expand release/setup-feedback client discoverability for current MCP clients.
- Extract app-level keyboard surface priority and shortcut composition from `App.vue` into a focused feature controller.
- Extract application command-palette routing from `App.vue` into a focused feature controller.
- Extract site controls, storage, privacy, and settings navigation composition from `App.vue` into a focused feature controller.
- Extract responsive-preview and environment-emulation composition from `App.vue` into a focused feature controller.
- Extract Downloads, Bookmarks, and History composition from `App.vue` into a focused browser-collections feature controller.

### Fixed

- Accept the case-insensitive HTTP `Bearer` authentication scheme used by standards-compliant MCP clients.
- Recover with safe defaults when profile persistence files contain a valid JSON value with the wrong shape instead of failing Hronaut startup.
- Make a first-instance `--quit` request exit cleanly instead of launching a new Hronaut window and MCP listener.
- Keep launch-only MCP port overrides separate from saved preferences so unrelated settings changes cannot persist the temporary port.
- Ignore unchanged MCP port submissions while the healthy listener is already running, while still allowing same-port recovery after a listener failure.
- Make concurrent first-start MCP token loads converge on one atomically published owner-only token without temporary-file collisions or token replacement.
- Include IPv6 cookie-only sites in browsing-data inventories without producing double-bracketed invalid origins.
- Persist the anonymous commercial-license installation identity on first load so activation device names remain stable across restarts.

## [1.9.5] - 2026-08-27

### Changed

- Extract panel registration, transient-panel coordination, detached-window synchronization, and developer-panel actions from `App.vue` into a focused feature controller.
- Extract page capture, export, diagnostics, and page-tools presentation composition from `App.vue` into a focused feature controller.
- Update Electron 42 to 42.10.1 for upstream window, Wayland, shutdown, printing, and renderer reliability fixes while the Electron 43+ migration remains blocked upstream.

### Fixed

- Release failed detached-panel windows and clear their runtime owner so a later detach request can retry after a renderer load failure.
- Remove malformed, duplicate, unsafe, expired, and overflow bookmark, credential, permission, and visit-history records from the persisted profile during startup repair instead of leaving filtered private data on disk.
- Strip embedded usernames and passwords from HTTP(S) bookmark URLs before storing them.

## [1.9.4] - 2026-08-27

### Changed

- Move settings, update, MCP, license, privacy, permission, credential, download, performance, and search feature composition out of `App.vue` into a focused controller.

### Fixed

- Keep replacement MCP listeners paused while port or reset settings are staging, then apply the latest pause and authentication state atomically at cutover.
- Generate Gemini CLI Streamable HTTP setup with its documented `httpUrl` schema so copied Hronaut Home configuration connects successfully.

## [1.9.3] - 2026-08-27

### Changed

- Document the release-synchronized Scoop command for installing the verified Windows x64 portable build and Start Menu shortcut.

### Fixed

- Keep MCP paused until password decryption and page injection finish, even when the user requests Resume during the fill.
- Keep MCP paused for the full browsing-data cleanup and preserve newer user or credential-fill pause intent when cleanup finishes.
- Complete renderer teardown even when one native listener or controller disposer throws, preventing later IPC subscriptions, timers, and shell resources from surviving an unmount.
- Roll back earlier native event subscriptions when a later subscription fails during renderer startup, preventing duplicate or orphaned IPC listeners after a retry.
- Roll back partially attached Downloads, Bookmarks, and History listeners when collection startup fails, allowing a clean retry without leaked or permanently missing updates.
- Fully tear down address-suggestion watchers and native overlay listeners after failed setup or shell disposal so queued work cannot reopen the overlay or navigate a page afterward.
- Roll back live MCP activity subscriptions when tab tracking cannot start and always clear agent badges, request state, and linger timers even if native listener teardown fails.
- Preserve and report the real update-service failure when listener cleanup also fails, and always clear pending update UI operations during teardown.
- Preserve MCP and commercial-license source errors through listener cleanup failures, and clear their pending UI feedback before teardown completes.
- Roll back partial title-bar listener setup and always remove remaining geometry listeners and safe-area styles when one cleanup fails.

## [1.9.2] - 2026-08-27

### Fixed

- Ignore late shell notifications after renderer teardown so delayed clipboard or browser-action failures cannot recreate toast state and timers after the app has unmounted.
- Serialize Hronaut Home status polling so a slow local MCP response cannot create overlapping requests, starve dashboard updates as stale, or accumulate pending work.
- Generate PowerShell-safe authenticated Codex and Claude Code setup commands on Windows, including token paths with spaces or apostrophes.

## [1.9.1] - 2026-08-27

### Changed

- Move panel-dock preference validation and persistence out of `App.vue` into a focused controller shared by shell layout behavior.

### Fixed

- Always release Chromium's native pointer when an element or coordinate drag fails mid-movement so later human and agent input cannot remain stuck in a pressed state.
- Keep Hronaut usable when local layout preference storage cannot be read or written, falling back to safe panel sizes and preserving live dock and workspace-collapse actions.

## [1.9.0] - 2026-08-27

### Added

- Show copy-ready connection verification commands for Codex and Claude Code on Hronaut Home, matching the existing OpenCode and Gemini CLI guidance.
- Advertise Hronaut's persistent-workspace, semantic-inspection, and human-handoff workflow through MCP server instructions during client initialization.
- Let agents hover bounded viewport coordinates to reveal tooltips and hover states on canvas, WebGL, maps, remote desktops, and other visual-only surfaces.
- Let agents drag between bounded viewport coordinates for canvas, maps, custom controls, remote desktops, and other pixel-precise targets.
- Add first-class Gemini CLI setup, authentication-aware configuration, and connection verification to Hronaut Home.
- Add a localized, copy-ready first-success task to Hronaut Home so a newly connected agent can prove isolated workspace creation, navigation, and semantic inspection immediately.

### Changed

- Move renderer startup, window-listener wiring, and idempotent resource disposal out of `App.vue` into a focused lifecycle controller.
- Move bookmark and history entry navigation out of `App.vue` into the existing browser-collections shell controller.
- Move guarded, serialized Chromium Developer Tools toggles out of `App.vue` into the browser-tab action controller.
- Move site and update settings-entry policy out of `App.vue` into a focused navigation controller.

### Fixed

- Preserve keyboard focus when switching Hronaut Home setup guides and expose the selected client as an accessible pressed button.
- Close About before opening Commercial license settings so the two modal surfaces never stack.
- Keep Find cleanup running when a competing shell action throws synchronously.
- Make the complete horizontal “Workspace” action, including its visible label, clickable instead of limiting its title-bar hit target to the plus icon.
- Keep a horizontal-only `browser_scroll` action from also applying the default vertical scroll distance.
- Prevent an older bookmark or history navigation from closing a panel that the user reopened while that navigation was still pending.
- Clear stale Downloads actions when the panel is closed so an older reveal, cancel, or cleanup cannot lock or report errors in a reopened panel.
- Keep an externally reopened Downloads panel visible when an older refresh fails after another shell action or download event changed its visibility.
- Prevent queued Network refresh and request-condition actions from running inside a panel that was closed and reopened by newer shell coordination.
- Keep diagnostic “Copied” feedback scoped to the current page and restart its confirmation timeout when the same report is copied again.
- Keep Console, Network, Site Storage, and MCP endpoint copy confirmations scoped to the latest clipboard action and current context, with full confirmation time after repeated copies.
- Keep Hronaut Home on the newest status response and prevent repeated or guide-switched setup copies from clearing, sticking, or showing stale feedback.

## [1.8.0] - 2026-08-27

### Added

- Let agents wait for full or same-document navigation to reach a wildcard URL pattern, with prompt tab-close cancellation and redacted matched URLs.
- Let agents wait for a snapshot ref or CSS selector to become attached, detached, visible, or hidden without brittle JavaScript polling.
- Let agents single- or double-click bounded viewport coordinates for canvas, WebGL, maps, remote desktops, and other visual-only surfaces without weakening the preferred semantic-ref workflow.

### Changed

- Move Home navigation, last-website tracking, and competing-surface cleanup out of `App.vue` into a focused controller.
- Left-align Home and the title/tab cluster in horizontal mode, and align the vertical rail title to its left edge while preserving native window-control safe areas.
- Move shell-wide browser, startup, search, settings, and clipboard feedback out of `App.vue` into a focused controller.

### Fixed

- Prevent an already-finished page from timing out when loading stops between `browser_wait`'s state check and lifecycle-listener registration.
- Honor accept and dismiss consistently for alerts, confirmations, and prompts opened by agent clicks without racing another dialog handler.
- Keep hidden-tab screenshots, PDF exports, and visual comparisons reliable when Chromium renders the offscreen surface but omits its first presentation callback under load.

## [1.7.0] - 2026-08-26

### Added

- Add an all-platform, restart-required “Use system title bar” fallback for desktop environments where compact window controls are unreliable.
- Add Ctrl/Cmd+1–8 direct website-tab selection and Ctrl/Cmd+9 last-tab selection for crowded horizontal and vertical tab layouts.

### Changed

- Replace the redundant main-window title row with a native-controls overlay: horizontal tabs, the vertical navigation row, and Home now provide compact drag surfaces with theme-matched controls.
- Keep the vertical tab rail in its own left column while navigation and address controls use only the right content column.
- Publish the verified Windows portable checksum into the Scoop manifest after each release, then automatically dispatch full CI and the Windows install/reinstall smoke.

### Fixed

- Match native tab-menu directions to the selected layout: vertical rails now say “Move Tab Up,” “Move Tab Down,” and “Close Tabs Below” instead of describing horizontal movement.
- Keep “Close Other Tabs,” “Close Tabs to the Right,” and “Close Duplicate Tabs” inside the selected tab’s workspace so cleanup cannot remove unrelated workspace tabs.
- Show authoritative success or failure feedback after a human PDF export, including write errors that occur after Page Tools closes.
- Keep every tab, address input, toolbar action, and menu control explicitly non-draggable, preserve bare-Alt access to the native application menu, and reserve left- or right-side window-control safe areas at narrow widths and scaled displays.
- Keep the selected crowded tab fully reachable when the window or title-bar safe area changes, including compact horizontal layouts.
- Keep MCP user-attention requests active when an agent shows or focuses Hronaut, clearing them only after real human input.
- Keep Site Storage controls locked while a write, delete, or clear is pending so rapid actions cannot overlap, show stale entries, or discard a newer edit draft.
- Reset both Memory Saver preferences in one persisted transaction so a write failure cannot leave only half of the defaults applied.
- Reset MCP authentication and its listener port as one main-process transaction so a busy default port cannot leave authentication disabled on the previous listener.

## [1.6.1] - 2026-08-26

### Added

### Changed

- Move browser navigation, address, find, zoom, and bookmark controls out of `App.vue` into a focused component.
- Move website interaction-lock, split-view, capture, picker, and page-tools controls out of `App.vue` into a focused component.
- Move docked-panel resize presentation and input events out of `App.vue` into a focused accessible component.

### Fixed

- Retry transient renderer service startup failures without requiring an application restart, while keeping retries bounded and reporting recovery.
- Apply rapid repeated mute and interaction-lock toggles in order against the latest browser state instead of losing the second user action to a stale renderer snapshot.
- Prevent an element picker from starting while a viewport or full-page screenshot is still capturing and writing to the clipboard.
- Keep the latest Settings change authoritative when concurrent responses settle in request order, including full Appearance resets and language snapshots.
- Keep the latest successful browser action authoritative when concurrent responses settle in request order, preventing rapid tab selections from reverting while retaining a successful fallback if a newer action fails.

## [1.6.0] - 2026-08-26

### Added

- Add Midnight and Sepia everyday themes plus Matrix, Machine, and Galactic cinematic themes, with matching previews, native control color schemes, address suggestions, localization, and reduced-motion-safe effects.

### Changed

- Split the renderer's global stylesheet into ordered token, base, shell, tool, collection, dialog, settings, and docking modules, and colocate toast presentation with its component.
- Move detached-panel query parsing, labels, and window-title presentation out of `App.vue` into a focused controller.

### Fixed

## [1.5.3] - 2026-08-26

### Added

- Add a zero-cost Windows Scoop package smoke test that builds the portable app locally, verifies its shortcut and loopback MCP runtime, preserves external AppData across uninstall/reinstall, and avoids consuming public release-download counts.

### Changed

- Move Help and support shell orchestration out of `App.vue` into a focused controller.
- Verify after every published release that `hronaut.dev` resolves the new version and every platform download.
- Move detached-panel refresh dispatch out of `App.vue` into a focused, exhaustively tested controller.
- Reset all Appearance preferences in one authoritative transaction and prevent conflicting settings edits while a reset is pending.
- Move Settings reset routing and Appearance defaults out of `App.vue` into a focused controller.
- Move Privacy Settings open, refresh, and search-reset lifecycle ownership out of `App.vue` into its focused shell controller.
- Move update-notification visibility and auto-dismiss timing out of `App.vue` into a focused lifecycle controller.
- Move locale-aware shell formatting out of `App.vue` into a focused reactive composable.
- Use 100% as the default interface scale for fresh profiles and Appearance resets while preserving an existing explicit scale choice.

### Fixed

- Report a failed native GitHub Repository menu action in the shell instead of only logging it.
- Report failed Help and support link navigation instead of silently closing the dialog.
- Keep committed language changes authoritative when the follow-up Home refresh fails.
- Keep committed MCP authentication changes authoritative when the follow-up Home refresh fails.
- Make tab mute and close actions keyboard-operable from the focused tab and remove invalid nested button semantics.
- Keep completed workspace storage transfers authoritative when the follow-up workspace refresh fails, and block duplicate transfers until that refresh settles.
- Keep a tab context update from canceling a newer detached-panel request, and suppress refresh failures from panels that have already been superseded.
- Reset the interface language to the system default with the rest of the Appearance preferences.
- Keep completed browsing-data clears authoritative when the follow-up website inventory refresh fails, instead of presenting the destructive clear as failed.
- Reveal the selected tab after startup when its workspace had previously been collapsed, while preserving collapse state for unrelated workspaces.
- Give workspace tabs valid tab-list semantics, keep Settings landmarks valid, and raise light-theme secondary text contrast to WCAG AA across browser controls and Settings.
- Keep crowded-tab scroll buttons in reserved space instead of covering workspace names, tab titles, and the selected-tab marker.
- Open scheme-less localhost and IP loopback development addresses over HTTP instead of forcing them through HTTPS and producing a TLS failure.

## [1.5.2] - 2026-08-25

### Added

- Show OpenCode's `opencode mcp list` connection check directly beside its Hronaut Home setup.

### Changed

- Make the selected tab unmistakable with a persistent accent marker and stronger active surface, including the collapsed vertical rail.
- Move the complete tab and application-action chrome into the left rail when tabs are placed on the left, leaving only the navigation and address toolbar across the top.

### Fixed

- Open commercial-license pricing directly in the system browser and send license API requests to the canonical domain without a redirect that can rewrite POST requests.
- Remove vertical tab overflow controls once the remaining tabs fit the full rail again.
- Keep the selected tab immediately visible when switching a crowded tab strip from the top to the left rail.

## [1.5.1] - 2026-08-25

### Added

- Let an unpinned vertical tab rail collapse to favicon width and temporarily expand for pointer or keyboard interaction.

### Changed

- Move localized keyboard-shortcut presentation out of `App.vue` into the Help controller.

### Fixed

- Keep crowded vertical tabs clear of the fixed previous/next scroll controls.
- Preserve every rapid next/previous-tab shortcut by queueing relative selections against the latest active tab.
- Wait for Electron to finish opening Developer Tools before allowing debugger-backed browser actions to continue.

## [1.5.0] - 2026-08-25

### Added

- Add a persisted top/left tab position setting with a scrollable vertical rail for crowded sessions.
- Add a workspace context action that sleeps only eligible background tabs while preserving active, pinned, busy, and unsaved-form tabs.

### Changed

- Move browser tab mutation and action-specific error policy out of `App.vue` into a focused controller.
- Move Console and Network panel shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep a partially visible active tab in view when earlier crowded-strip items expand, while still respecting deliberate scrolling away from it.
- Prevented rapid detached Page Tools switches from refreshing a panel that was already superseded before rendering.
- Keep the active tab visible when earlier pinned tabs or workspace labels expand in a crowded strip, without overriding deliberate tab-strip scrolling.
- Cancel a queued Network refresh when the panel is closed again before it finishes opening.

## [1.4.5] - 2026-08-25

### Changed

- Move global shell keyboard, modal priority, and Escape-surface routing out of `App.vue` into a focused controller.
- Move saved-password fill and account-picker orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep command palettes, dialogs, and tool panels open when Escape belongs to an active IME composition.
- Cancel a pending credential fill when the user changes tabs or its page navigates or reloads, including same-origin pages, instead of filling a stale background document.
- Keep IME candidate navigation and confirmation inside address, command, tab-search, and credential inputs instead of moving, running, filling, or closing shell results.

## [1.4.4] - 2026-08-25

### Changed

- Split active-tab context transitions and detached-panel refresh coordination out of `App.vue` into focused controllers.
- Move shell overlay exclusivity, relayout, and native address-overlay coordination out of `App.vue` into a focused controller.

### Fixed

- Close crowded tabs with the familiar middle-click gesture without activating the page or bypassing the global interaction lock.
- Reset docked diagnostic panels when the current page reloads at the same URL so stale Network and Console evidence is not left visible.
- Keep an active tab visible when its workspace changes, and recompute crowded-tab overflow after tabs move into collapsed workspaces.
- Keep the active tab visible when a crowded tab strip becomes narrower after a window or toolbar resize.
- Close every competing docked tool panel when Site Controls, Site Storage, Bookmarks, or another shell overlay opens.
- Ignore stale detached-panel refresh failures after a newer tab context or window teardown.

## [1.4.3] - 2026-08-25

### Added

- Add workspace-aware Left/Right/Home/End keyboard navigation across visible tabs, with manual Enter/Space activation so browsing tab labels does not wake or switch pages.

### Changed

- Split address-focus and new-tab shell orchestration out of `App.vue` into focused navigation controllers.
- Split Site Storage shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Prevent delayed shortcut or workspace tab creation from stealing address focus after a newer tab selection.
- Reject cross-workspace tab drag targets before showing a drop indicator or attempting an invalid reorder.
- Suppress obsolete Site Storage refresh failures after the panel closes or resets for a newer tab.

## [1.4.2] - 2026-08-25

### Fixed

- Keep crowded tab strips navigable with visible overflow controls, horizontal mouse-wheel scrolling, and automatic active-tab reveal.

## [1.4.1] - 2026-08-25

### Fixed

- Make `browser_press` dispatch modifier combinations and printable characters correctly instead of sending chord text as an invalid literal key.

## [1.4.0] - 2026-08-24

### Added

- Let `browser_wait` accept up to 20 candidate texts and resolve with the first visible match for workflows with multiple possible outcomes.
- Let `browser_click` dispatch Chromium's native double-click sequence for controls that require two clicks or a `dblclick` event.

### Changed

- Split Find-in-page shell orchestration out of `App.vue` into a focused controller.
- Split Tab Search shell orchestration out of `App.vue` into a focused controller.
- Split Zoom shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close the Split View menu and other competing surfaces when Find-in-page opens instead of stacking controls over the page.
- Close the Split View menu and other competing surfaces when Tab Search opens instead of stacking side panels over the page.
- Close the Split View menu and other competing surfaces when Zoom opens instead of stacking controls over the page.
- Fail `textGone` waits when the renderer cannot verify page text before the deadline instead of reporting unobserved absence as success.
- Reject `browser_click` prompt text unless the same call explicitly accepts the prompt, preventing an accidental blocking native dialog.

## [1.3.0] - 2026-08-24

### Added

- Add `textGone` to `browser_wait` for bounded waits until rendered page text disappears.

### Changed

- Split shared transient-panel closing policy out of `App.vue` into a focused controller.
- Split Split View menu shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close Find-in-page immediately when Page Tools or another transient panel opens, while completing browser-side Find cleanup in the background.
- Close Find-in-page when the Split View menu opens instead of stacking both controls over the page.

## [1.2.2] - 2026-08-24

### Changed

- Split Privacy Settings shell orchestration out of `App.vue` into a focused controller.
- Start Home, address-focus, and Zoom actions before awaiting Find-in-page cleanup through a shared transition controller.
- Retain the first failed Playwright Electron trace in CI without enabling retries, extract diagnostics from the disposable Docker container, and upload them for seven days.

### Fixed

- Open Privacy Settings immediately while Find-in-page cleanup finishes, and keep a newer close, section change, or Privacy request authoritative over delayed cleanup results.
- Prevent delayed Find-in-page cleanup from opening Home after a newer tab selection.

## [1.2.1] - 2026-08-24

### Added

- Add verified OpenCode MCP setup to Hronaut Home, the README, and the public setup guide, including global/project paths and connection diagnostics.

### Changed

- Split browser-collection panel orchestration out of `App.vue` into a focused controller.
- Split Site Controls shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep the newest Downloads, Bookmarks, and History request authoritative, and prevent a late Downloads refresh from reopening or displacing a newer panel choice.
- Prevent a delayed Find-in-page cleanup from opening Site Controls underneath a newer Settings surface.
- Generate authenticated OpenCode headers with its token-file substitution instead of asking people to paste the owner token into JSON.
- Show the Hronaut “H” mark on Home instead of the stale pre-rename “B”.
- Document the canonical Cloudflare Pages storefront repository instead of a nonexistent GitHub Pages workflow in the desktop repository.

## [1.2.0] - 2026-08-24

### Added

- Add `browser_generate_locator`, which turns a snapshot ref or CSS selector into a unique Playwright locator while excluding form values and page source.
- Cover semantic, test-ID, CSS-fallback, escaping, and privacy edge cases with unit and real-Electron Docker regression tests.

### Changed

- Split command-palette shell orchestration and exhaustive command dispatch out of `App.vue` into a focused controller.
- Update the Home and public website catalog to advertise all 65 MCP tools and the locator-generation workflow.

## [1.1.1] - 2026-08-24

### Fixed

- Open **Buy commercial license** in the operating system's default browser instead of creating a Hronaut tab.

## [1.1.0] - 2026-08-24

### Added

- Add `browser_find`, a bounded literal search over Hronaut's sanitized semantic page snapshot that returns compact matching snippets and refs.
- Cover extracted browser-shell components, compact snapshot search, release workflow contracts, and the new MCP capability with unit and real-Electron regression tests.

### Changed

- Split the address and site-controls row, recoverable page-problem bar, and detached-panel empty state out of the renderer root component.
- Require lint, unit tests, production builds, dependency audits, and the Docker Electron suite before release package builds can start.

### Fixed

- Keep the Home dashboard and public website MCP tool counts derived from or tested against the live server catalog.
- Preserve source offsets for case-insensitive snapshot matches whose Unicode case folding changes string length.

## [1.0.0] - 2026-08-24

### Added

- Launch Hronaut 1.0.0: a visible, persistent local browser and QA workspace controlled through MCP.
- Publish Hronaut under the PolyForm Noncommercial License 1.0.0 with a separate paid commercial subscription license.

### Changed

- Establish the Hronaut release, update, package, executable, URL-scheme, profile, and environment-variable identities.
- Move the canonical source and release feed to `github.com/hronaut/hronaut`.
