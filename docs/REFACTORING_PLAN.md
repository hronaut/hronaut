# Technical-debt reduction plan

Reviewed September 24, 2026. Implement one independently verifiable extraction
per commit. Status is recorded under each boundary below.

## First: collection title sanitization

`src/main/history-store.ts` and `src/main/bookmark-store.ts` duplicate credential
detection, fallback-title repair, whitespace cleanup and Unicode truncation.
The oversized credential URL title bug needed the same fix in both stores.
Implemented the shared title policy in `src/main/collection-title.ts`, with
explicit URL normalization and fallback policies supplied by each store. Keep
history's fragment removal and bookmarks' fragment retention explicit, and
retain the distinct storage limits, retention, deduplication and visit-count
behavior in their owning stores. Avoid introducing a generic persistence layer
as part of this change.

## Download ownership

`src/main/browser/downloads-controller.ts` now owns download maps, session
listeners, reserved paths, cancellation, reveal actions and notifications. Its
host interface supplies settings, download source attribution, workspace
generations and publication; tab and workspace authority stays in the manager.
The existing real Electron cases cover progress, cancellation, clear, reveal,
path collisions, interrupted transfers and workspace archive/restore. Controller
tests additionally cover the history cap and active transfers across workspace
observation generations.

Before extraction, regression coverage now exercises resumable interrupted downloads. Electron's
[DownloadItem contract](https://www.electronjs.org/docs/latest/api/download-item)
distinguishes nonterminal `updated: interrupted` from terminal
`done: interrupted`. The previous `listDownloads()` removed the live item whenever
its state differed from `progressing`, and clear/trim used the same state-based
terminal assumption. The real Electron regression reproduced a spurious
completion timestamp after listing a resumable item. The fix retains native
items while resumable and shares active/finished classification through
`src/shared/download-state.ts`; cancellation and clear behavior now pass in
Docker, with renderer coverage for live and terminal interruptions. The controller extraction retains these lifecycle rules.

## Main-process composition

Collection and download IPC registration now lives in
`src/main/collection-ipc.ts`. Dependencies resolve lazily after the trusted-sender
check, preserving early registration before the window loads. Tests cover every
channel rejecting untrusted callers, argument validation, and publishing only
after successful persistence. Startup ordering, window ownership and shutdown
orchestration remain in the entry point. Continue extracting cohesive domains
with explicit dependencies and trusted-sender checks on every privileged handler. Update and license lifecycle
extraction should be separate changes with their existing regression suites.

## MCP tool families

Separate tool definitions and domain handlers from `src/main/mcp/server.ts`.
Keep the mandatory dispatch path for authorization, write leases, pause state,
human review and cancellation centralized. Extract a low-coupling family first
and compare advertised schemas and tool behavior before and after the move.
Do not create alternative registration paths that can bypass dispatch checks.

## Test organization and fixture ownership

Split `tests/integration/browser-shell.e2e.ts` by behavior, preserving isolated
profiles, semantic assertions and teardown. The earlier capability-suite split
provides a precedent. The emulation suite is now split into responsive preview,
environment configuration and JavaScript/offline reset workflows, preserving
isolation and reset assertions while removing their shared 45-second deadline.
Activity assertions now hold a real MCP command open until both indicators are
checked, rather than racing its completion grace period.
Tests that inject update state must disable startup update
checks before launch; the workspace-scale failure demonstrated how an unrelated
timer can invalidate an otherwise correct layout assertion.

## Preview capture

Implemented two separate boundaries: `native-preview-capture.ts` retains native
capture ownership beyond the caller's timeout, and `preview-capture-queue.ts`
owns per-tab coalescing and global serialization. The manager still owns tab
eligibility, settle timers, image encoding, cache publication, and late recovery.
Keep these policies explicit rather than moving the remaining preview methods
into a controller that merely forwards calls back to the manager. The combined
runtime passed 552 Electron cases and native dialogs without retries.

## Next: network event recording

`TabsManager.handleNetworkDebuggerMessage` and its adjacent lookup, timestamp,
stream-retention, and request-trimming helpers form a synchronous boundary.
Extract them with `BrowserNetworkRequestRecord` into a network recording module.
Its state should contain only the request history, capture sequence, observation
generation, and security snapshot; it should not need Electron `WebContents` or
the complete `BrowserTab`. Preserve the current mutation model so waiters and
diagnostic readers continue to see the same tab-owned records.

Keep debugger attachment, `Fetch.requestPaused` interception, response-body
retrieval, navigation clearing, and control-handoff generation changes in the
manager. In particular, the debugger message listener must notify network waiters
after applying each event, as it does today. Moving interception into this first
extraction would combine asynchronous native ownership with synchronous history
updates and make the change harder to verify.

Characterization coverage should exercise redirects reusing a CDP request ID,
redirects crossing an observation generation, WebSocket creation and handshake
ordering, completed-request filtering, stream retention/drop counts, failed
loads, and document security metadata. Existing real Electron network and
workspace-handoff coverage must continue to verify privacy, request relationships,
and isolation. Preserve current retention order and timestamp semantics during
the extraction; any policy change needs its own failing-before regression.

Debugger attachment and DevTools handoff remain a later independent extraction.
Keep generation checks, debugger leases, focus restoration, and disposal
explicit. Similar generation counters do not necessarily represent
interchangeable lifecycle semantics.

## Verification

Preserve behavior first, using existing regression tests plus tests for any
newly exposed lifecycle edge. Run focused Docker cases while iterating, static
gates, then the immutable Docker integration gate before delivering runtime
changes. File-size reductions alone do not demonstrate reduced coupling.
