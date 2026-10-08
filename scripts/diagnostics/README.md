# Offline Playwright protocol timing overlay

This review-only tool addresses an evidence gap in the continuity resize
investigation: existing API traces do not establish when an evaluation reached
the protocol transport. It does not fix or diagnose the release failure itself.
It is not imported by application code, Playwright fixtures, CI, or releases.
No capture or experiment is authorized by adding this tool.

`protocol-timing-overlay.ts` accepts the exact Playwright **1.63.0** core bundle,
SHA-256 `549070af3acabb3efcc4f55bfe6210f9f7c2fcf633cf7eaa59bfe60719969171`.
Version, hash, or anchor mismatch throws before output is written. The optional
CLI takes source-bundle, package-manifest, and NEW output-file paths; exclusive
creation prevents overwriting an installed bundle. Loading that output would
require an isolated copy of Playwright with its relative dependencies. This PR
only verifies generation and synthetic execution; it supplies no capture runner.

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
