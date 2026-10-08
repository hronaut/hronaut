# Offline Playwright protocol timing overlay

This review-only tool addresses an evidence gap in the continuity resize
investigation: existing API traces do not establish when an evaluation reached
the protocol transport. It does not fix or diagnose the release failure itself.
It is not imported by application code, Playwright fixtures, CI, or releases.
No capture or experiment is authorized by adding this tool.

`protocol-timing-overlay.ts` accepts the exact Playwright **1.63.0** core bundle,
SHA-256 `549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171`.
Version, hash, prologue, or anchor mismatch throws before output is written.
The exact original top-level `"use strict";` remains first; the observer is
inserted immediately after it and before the original executable body. The optional
CLI takes source-bundle, package-manifest, and NEW output-file paths; exclusive
creation prevents overwriting an installed bundle. Loading that output would
require an isolated copy of Playwright with its relative dependencies. This PR includes an explicit opt-in disposable capture runner, verified only
with synthetic tests. Real browser capture requires separate approval.

The generated module exports `__hronautProtocolTimingSnapshot()` for a future,
separately reviewed collector. Snapshotting copies the ring; no automatic file,
console, environment, network, shutdown, or timer hooks are installed. The hot
path performs no I/O, added parsing/stringification, awaits, or browser getters.
Upstream serialization, WebSocket call, setImmediate scheduling, JSON parsing,
callback lookup/deletion, and callback invocation retain their ordering.
Original Playwright error logging remains unchanged; it is NOT part of this
privacy-safe output and must not be collected as if it were sanitized.

Each retained row contains seven numbers:
`[stage, transport, channel, request, receive, methodClass, monotonicMs]`.
Channel 1 is Electron's Node inspector; channel 2 is Electron's Chromium
transport, which can carry multiple target sessions. Numeric transport IDs are
local to this bundle instance; request IDs are CRConnection-wide. No session,
target, context, URL, expression, argument, result, credential, error text, or
error code is retained. Unknown method classes map to 0. Known classes are:
1 Runtime.evaluate, 2 Runtime.callFunctionOn, 3 executionContextCreated,
4 executionContextDestroyed, 5 executionContextsCleared, 6 attachedToTarget,
7 detachedFromTarget, 8 targetDestroyed, 9 targetCrashed.

Stages: 1 immediately before ws.send (after normal serialization), 2 synchronous
ws.send return, 3 ws.send throw, 4 raw message receipt timestamp, 5 parsed dispatch,
6 matched CRSession callback boundary (after lookup/deletion, before resolve or
reject), 7 malformed JSON, 8 dispatch throw, 9 socket close. Stage 2 proves only
transport handoff, never delivery or execution. Stage 6 does not prove the client
API promise has settled. Raw receipt retains only a temporary numeric token;
its row is published after the ORIGINAL parse, sharing that token with parsed
dispatch and callback. Malformed JSON records only stage 7. Browser-close sentinel
-9999 produces no message rows. Rows are insertion ordered, so a raw timestamp
may precede earlier inserted rows; use numeric timestamps when comparing phases.

Only the first 64 registered transports are observed. The ring retains the last
2048 rows and reports total/dropped counters. IDs/counters stop at safe-integer
bounds. Weak maps do not retain transport/message objects; payload properties
are neither traversed nor copied. Oversized payloads remain the upstream parser's
responsibility: the observer performs bounded property reads and class mapping.
Observer exceptions are swallowed without replacing upstream exceptions.
Connections/events before Electron transport registration, pipe transports,
other browser engines, API admission, and uncorrelated API-to-wire attribution
are outside coverage. Missing rows, eviction, or observer failures mean unknown,
not evidence of absence. Instrumentation can perturb timing; synthetic ordering
proof is not proof of zero overhead or a reproduction of the intermittent stall.

Synthetic tests execute the actual pinned transport/CRSession sections with a
fake socket/scheduler, compare original and patched ordering, and exercise
correlation, sentinel/privacy exclusion, malformed and oversized inputs,
exceptions, source pins, and memory caps. Original assertions, timeouts, retries,
flaky gates, OS permissions, and production code are unchanged.

## Disposable loader and collector (review required before running)

`prepareCapture` makes a fresh private copy, verifies the pinned bundle, selected
case, config and fixture, generates the overlay there, and inserts a synchronous
collector as the FIRST operation of the selected case's existing `finally`.
A second collection boundary immediately after fixture `use(app)` settles
covers a timed-out body whose own finally has not run; exclusive creation keeps
the first snapshot. Both boundaries precede fixture diagnostics and close.
The case boundary also precedes MCP-client/server closure, fixture
`collectRendererDiagnostics`, tracing shutdown and `closeHronaut`. If setup,
timeout or worker death prevents that boundary, evidence is **unknown**. There
is no fallback fresh observer or empty-success record. No post-cleanup snapshot
is currently taken. The original checkout/installed packages are not patched.

`runPreparedCapture` requires explicit opt-in and has no CLI/workflow entry. It
runs exactly the original named continuity case, its complete 2×2×2 matrix, one
worker, existing CI retry=1 and failOnFlaky settings, once. No repeat loop or
extra test deadline is added. It uses a private TMPDIR inside the disposable
copy. The runner requires an immutable, already-installed Docker image ID and
uses `--pull=never` and a new container with private PID/IPC namespaces, init
and no logging driver. Container UID/GID are explicitly the host caller UID/GID,
so 0600 snapshots and nested 0700 directories remain readable/removable by the
caller without chmod or extra groups.
There are no added capabilities, privileged flags, host PID/socket mounts or
host ports. Cancellation stops the container with zero grace, verifies Running=false/Pid=0,
then removes it and verifies absence, covering detached Electron
process groups; successful absence verification is required before removing the
owned copy. Unverified container teardown retains that copy and reports
`containmentStopped=0`, `cleanup=0`, invalid diagnostics. Docker control failures
never become cleanup success. The copy path must be visible to the same local
Docker daemon (use a disposable directory on the shared workspace filesystem).
The actual runner maps SIGINT/SIGTERM and external cancellation to its owned
AbortSignal, awaits container cleanup, then restores signal handlers. It never
uses process.exit to skip teardown. Uncatchable host termination still requires
the future hosted harness to perform external container cleanup; that harness
is not supplied or approved here. No capture or release decision is implied by
these exported APIs.

Module resolution from the checkout, playwright and @playwright/test must all
reach the plain copied core bundle. The collector checks its full file hash,
content fingerprint, actual require-cache identity, and loaded export marker;
an original, alternate, symlinked, missing or differently cached bundle is
rejected. It never loads a replacement observer at collection time. Output
requires 1–63 registered transports, zero refused transports/observer errors,
and at most 2048 seven-number rows. Empty, malformed, oversized or missing
snapshots are explicit unknown; eviction marks the snapshot partial. Input file
reads are bounded before allocation/parse (256 KiB snapshot, 1 KiB verdict).

The container is never attached and uses `--log-driver none`, including renderer console errors and original
Playwright error logs. A fixed numeric reporter replaces line/HTML output only
inside this opt-in invocation. Original screenshots/traces may still be generated
inside the copy to preserve test behavior, but are never uploaded/exported and
are removed with it. There is no wildcard artifact export. Only the validated
numeric snapshot/verdict envelope is written with exclusive creation. No raw
exception text is surfaced by collection/publication failures.

The envelope preserves `exitCode` (−1 means unavailable), `killed`, reporter
status/attempts and `flaky` separately from `artifactValid`, `cleanup` and
`publication`. A passing child with missing evidence is invalid diagnostics; a
failed or flaky child stays failed even when diagnostics are valid. A future
hosted caller must preserve that original exit verdict and separately require
valid publication. No job that uploads generic failure artifacts may wrap this
runner without another review of the output boundary.

The host-only `tests/proofs/protocol-container-cancellation.ts` test explicitly
starts synthetic parent/detached-grandchild processes in this same boundary,
verifies a distinct detached process group and live heartbeat, cancels, verifies
Docker reports Running=false/Pid=0 before container removal, checks absence and
that the grandchild heartbeat stopped, and only then removes the copy. It launches no
Electron/browser. Unit tests separately prove unverified stop retains the copy
and cannot claim rollback success. This containment correction is not a
production stall fix and does not clear the failed release gate.

The same host proof also invokes the actual collector under the intended
container UID/GID, checks mode/ownership of its 0600 snapshot and 0700 parent
folders, reads the snapshot from the non-root host, and removes the nested copy
without permission changes. Unit coverage exercises both signal handlers at the
actual runner entry and verifies awaited cleanup and restored listeners.
