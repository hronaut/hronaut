# Diagnostic draft: OOPIF routing readiness

Do not merge or release this branch. No production code changes. No hosted run is
admitted by this document. Independent review of the exact commit is required
before one manual dispatch. This is not a fix or a replacement admission gate.

## Preserved evidence and question

Main fe51aedd58fbc8fd86d5475d1c905a8d234f3e8e failed CI 38115599919,
job 114399760646, on the first cross-origin native-click attempt. The original
immediate parent counter was zero; the built-in retry passed. Native events used
root coordinates (320,220) on failure and widget-local (70,60) on retry. This does
not establish an offset bug. Main remains blocked, including release admission.
The original artifact and all 64 earlier local samples remain outside this branch
under `/workspace/evidence/`; none are overwritten or reclassified.

The question is whether an unsuccessful single click reaches root DOM, child DOM,
neither DOM, or reaches the child with a delayed parent postMessage observation.
Readiness and command/frame/native timelines provide correlation, not causation.

## Proposed single run, only after exact-head independent admission

Dispatch the already-registered `ci.yml` once with ref
`diagnostic/oopif-routing-readiness`. Verify the branch SHA still equals the
reviewed SHA before dispatch and supply it as required input `expected_sha`.
The executable first step validates 40 lowercase hex characters and equality to
GITHUB_SHA before checkout. Checkout pins the trusted `github.sha` context (equal to the admitted input after
the guard), avoiding input-driven checkout. A second check verifies
HEAD before Docker execution. A missing, malformed or mismatched SHA fails closed.
Verify the resulting run's head SHA. Never
rerun an unchanged failure to green. The draft replaces this branch's manual CI
workflow only; it cannot package, publish, or run on main/tags. It must never merge.

The one workflow has two separate matrix arms, each on its own ubuntu-latest
runner, using the unchanged pinned Dockerfile, bridge networking, init/ipc
settings, application build, original full shard 3/8, one worker, CI retry=1,
failOnFlakyTests=true, and retain-on-failure trace setting. Neither arm filters or
adds integration tests. The ordered list remains 150 tests in 39 files, including
all original predecessors. Native dialogs remain disabled for shard 3 as before.
The static gate and other seven shards are not run; this is diagnostic evidence.
There is no startup/test retry beyond the original Playwright retry policy.

- `baseline`: original root-document-complete readiness; one unchanged MCP click,
  original immediate root hit read and original assertion. No new awaited operation
  precedes the click or intervenes before the immediate read.
- `native-route-ready`: separately issues one fixture-only CDP mouseMoved at
  (320,220), waits at most 500ms for native mouseMove at (70,60), then performs
  that same single MCP click and immediate assertion. It records whether the
  barrier was observed. A timeout does not become an assumed readiness success.
  This arm intentionally changes scheduling and input history. Its success is
  never evidence that baseline or production was repaired. Native hooks have no
  frame identity; (70,60) alone does not prove which DOM receiver handled motion.

## Observers and timing limits

Inline fixture listeners record root/child pointer and mouse receivers, fixed
button/document/other target roles, trusted flags, local/screen coordinates,
Date.now timestamps, DOM event timestamps, document readiness/load, and synthetic
postMessage send/receive times. The child click counter is read after the original
assertion; it is not an extra pre-assertion read. The original onclick and parent
message-count behavior remain. A capture listener records clicks before onclick.

The existing native hook and existing async sendCommand wrapper remain. Added
synchronous, no-throw observers record command-entry and native callback times,
plus root/child process/routing IDs at each command. There are no added await,
then, finally, or settlement observers in the command wrapper. Exact command-exit
times are intentionally unavailable; MCP start/return bracket the operation.
Native hooks lack DOM target, trust, frame identity and screen coordinates; these
unavailable fields are null/unknown, not inferred from input shape. Frame snapshots
do not observe native attachment events before probe installation.

Only after the original assertion, an event-driven observer checks the parent's
message delivery for up to 500ms. The complete collection await is capped at
1500ms and cannot replace the assertion. Native records, frame snapshots, root
observation and child reads settle independently. Already returned records survive
another reader's rejection or the global timeout; late completions cannot mutate
the returned record. Fixed per-reader availability enums distinguish fulfilled,
rejected, timeout and unavailable. Observer availability is separately recorded.
There is no repeated click, pre-click sleep, screenshot, paint wait, or hit-test
readiness substitution in baseline. All observer callbacks are no-throw and
native hooks are restored by the existing finally cleanup.

Instrumentation still perturbs timing: extra inline script parsing/listeners,
clock reads, bounded array writes, and synchronous frame enumeration. It is not
byte-identical replay. Date.now has millisecond granularity and cross-process
DOM event timestamps have different time origins. Post-assertion collection and
file writes can affect later tests and retries. The 500ms/1500ms bounds are
observation limits, not application success timeouts. Missing/capped observations
or green runs cannot establish the cause or a production repair.

## Privacy and artifact bounds

The diagnostic serializer reconstructs a fixed schema, accepts only known enums,
finite numeric values and booleans, and never spreads input. It exports no URL,
port, page body/text, DOM attributes, message payload, raw tool result, exception,
profile path, environment, secret, trace or screenshot. DOM reads are restricted
to the two exact loopback synthetic fixture URLs.

Each target attempt exports at most 64KiB, two attempts per arm. Root/child/native
event arrays have at most 32 entries each; commands and command-frame snapshots
have at most 12; each frame snapshot at most four frames. Observers count dropped events and observer errors, saturating at 1,000,000.
Counter saturation or any drop sets the truncation indicator; exporter truncation
counts are separate from observer drops. Missing counters remain null. Root/child
observer installation availability is explicit. The fixed numeric/enum schema
never exports exception text. The final exporter accepts only known report
filenames, each at most 64KiB. A separate bounded report decoder exports opaque
hex test IDs, outcome enums and each original retry/status for up to 200 tests,
at most 64KiB per arm. It excludes all titles, errors, attachments and bodies;
parser failure yields available=false. The Docker exit code is retained and
propagated, including failures and flaky-gate failures. Global errors retain a
count only. Raw errors are unavailable in the new uploaded artifact.

The two-arm artifact total is at most approximately 384KiB plus tiny exit-code
records, retained seven days. Raw Docker logs, traces and HTML stay in ephemeral
runner/container storage and are not uploaded; cleanup removes the local raw
copies/container. Original historical failure receipts remain untouched. Any
unrelated new failure remains a failure; this diagnostic job cannot clear it.

## Local collector validation

Focused TypeScript/lint, serializer unit tests, offline report-export tests, shell
syntax and ordered-shard comparison are required before presenting the draft.
Focused host-Xvfb runs of the three original cases validate both collector arms.
They are not the full hosted Docker shard and cannot reproduce its ordering or
resource conditions. Full static/release gates and hosted dispatch remain pending
independent review. No product repair has been established.
