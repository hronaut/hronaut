# Technical-debt reduction plan

Reviewed September 24, 2026. These are proposed boundaries, not completed
refactors. Implement one independently verifiable extraction per commit.

## First: collection title sanitization

`src/main/history-store.ts` and `src/main/bookmark-store.ts` duplicate credential
detection, fallback-title repair, whitespace cleanup and Unicode truncation.
The oversized credential URL title bug needed the same fix in both stores.
Extract the shared title policy after the regression fix is verified. Keep
history's fragment removal and bookmarks' fragment retention explicit, and
retain the distinct storage limits, retention, deduplication and visit-count
behavior in their owning stores. Avoid introducing a generic persistence layer
as part of this change.

## Next: download ownership

`src/main/browser/tabs-manager.ts` owns download maps, session listeners,
reserved paths, cancellation and reveal actions alongside tab lifecycle.
Extract a download controller with a narrow host interface for workspace/tab
lookup, settings, native dialogs and change publication. Follow the existing
`profiling-controller.ts` pattern. Preserve session listener lifetime, duplicate
path reservation, workspace attribution, cancellation and shutdown behavior.
Use the existing real Electron download cases as the behavioral contract.

Before extraction, investigate resumable interrupted downloads. Electron's
[DownloadItem contract](https://www.electronjs.org/docs/latest/api/download-item)
distinguishes nonterminal `updated: interrupted` from terminal
`done: interrupted`. The current `listDownloads()` removes the live item whenever
its state differs from `progressing`, and clear/trim use the same state-based
terminal assumption. Reproduce cancellation and clear behavior with a real
interrupted item in Docker before deciding whether this requires a fix. This
review identified a candidate, not a verified runtime failure.

## Main-process composition

Move cohesive IPC registration groups out of `src/main/index.ts`, beginning with
collections and downloads. Pass explicit dependencies and retain trusted-sender
checks on every privileged handler. Leave startup ordering, window ownership
and shutdown orchestration in the entry point. Update and license lifecycle
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
provides a precedent. Tests that inject update state must disable startup update
checks before launch; the workspace-scale failure demonstrated how an unrelated
timer can invalidate an otherwise correct layout assertion.

## Later extractions

Preview capture and network interception are further candidates within
`TabsManager`, once downloads establish the boundary pattern. Keep navigation
generation checks, debugger leases, focus restoration and disposal explicit.
Avoid a broad asynchronous-controller abstraction until its differing lifecycle
requirements are documented; similar generation counters do not necessarily
represent interchangeable semantics.

## Verification

Preserve behavior first, using existing regression tests plus tests for any
newly exposed lifecycle edge. Run focused Docker cases while iterating, static
gates, then the immutable Docker integration gate before delivering runtime
changes. File-size reductions alone do not demonstrate reduced coupling.
