# Same-origin iframe observations

`browser_snapshot action=capture frameSelector="#preview"` reads one directly
embedded, visible HTTP(S) iframe without switching frame context. The selector
must identify exactly one top-document light-DOM iframe. `maxChars` defaults to
8000 and accepts 1000–16000 as an upper bound. It cannot be combined with
`rootSelector`, quality checks, baselines or deltas.

The result has `kind: "frame-observation"`, `formatVersion: 1`, an opaque
`captureId`, `scope: "direct-child-viewport"`, untrusted text, limits and explicit
omissions. It has no actionable element references. Parent references, workspace
default tab, focus, scroll and visible selection remain unchanged. Frame reads
do not wake sleeping or frozen tabs, follow agent activity, or count as whole-page
readiness probes. Read-only grants can authorize them within their existing
workspace and origin restrictions.

## Provenance and unsupported contexts

Parent and child must have observed, correlated Document requests, final responses
and commits in the existing application-owned CDP session. Their committed URLs
must have equal canonical scheme, host and effective port. Exact DOM owner/frame
mapping is checked separately. Native `contentDocument` access from a private
parent isolated world enforces SOP; universal access is disabled. Privileged CDP
node access is not itself a same-origin check. Sandbox (including CSP sandbox),
srcdoc, blank, opaque and foreign-origin documents are unsupported. Legacy
`document.domain` relaxation does not widen the accepted origin.

Unknown prior history is unavailable. The operation never reloads a page, attaches
a debugger or takes ownership from Developer Tools to acquire history. A later
normal navigation can supply fresh history when the session remains supported.
Session loss, process swaps, BFCache restores, missing identity and history-cap
exhaustion fail closed. `document.open` permanently invalidates that loader;
replayed or late events cannot restore it. A new correlated document is required.
HTTP 404/500 may still be readable documents. A redirect requires its final
response. Cache and service-worker responses do not imply fresh origin-server
content. Canceled, failed and no-content navigations do not qualify as new
observed documents.

## Observation limits

This is a browser-observed point-in-time result. Pending navigation and observed
navigation, document replacement or authority changes invalidate it through final
response acceptance, including awaits for audit persistence and authorization.
It is not a guarantee against undispatched renderer intent or future changes.
Audit operation outcomes do not certify that later response delivery was fresh.

The capture includes native heading lines (`h1`–`h6`), bounded authored control
labels and disabled/checked states, sanitized link targets, and public viewport
text. Native controls and the supported ARIA button/link/checkbox/radio/tab roles
receive no actionable identifiers. Label sources are `aria-label`, `title`,
bounded visible `aria-labelledby`/native label text, then bounded public descendant
text. This is a bounded semantic observation, not a full accessibility tree or
computed accessible-name implementation. Placeholder, value and selected-option
content are never label sources. Form controls can expose authored identity and
boolean state while their value/editor contents remain excluded. Link targets
remove credentials and fragments and redact recognized secret query keys.

Only conservatively bounded viewport text is collected. Partly clipped text nodes
are omitted in full, even if a prefix is visible. Uncertain transforms, masks and
similar layouts are omitted. Independent rotate/scale/translate and zoom are
unsupported. Overflow intersects each axis with the padding/client box, excluding
borders and scrollbars; fractional clipping geometry is omitted conservatively.
This is a geometric observation, not a screenshot or proof of occlusion. Nested frames, shadow contents, generated CSS content and
live form/editor values are outside the scope. Closed shadow content cannot be
enumerated. Authored public text remains untrusted; recognized diagnostic secrets
and URL credentials are redacted. No observation guarantees detection of every
secret in authored page text.

Each selector/text walk visits at most 10,000 nodes, with depth at most 100 and a
cooperative 100ms renderer budget. Output can be shorter than `maxChars`, including
empty. Omissions distinguish clipping, privacy, nested frames, traversal and text
limits. Semantic collection caps headings at 80, controls at 500, and public
label records at 1000; labels have a 300-character limit and at most eight
referenced/associated label nodes. `semantic-limit` reports exhausted label or
category bounds. The requested character bound is enforced again after secret
redaction, which can expand text. Empty or partial observations do not prove
absence. The complete duplicated JSON MCP envelope is capped at 32,768 UTF-8 bytes; envelope trimming is reported.

The capture/final-check deadline is 1500ms. A timeout stops waiting; it does not
cancel renderer execution or guarantee the duration of outer audit storage.
Mutation guards consume at most 1000 total record/node/ancestor work steps and
20ms of cumulative cooperative callback time, then invalidate and disconnect.
One unfinished operation per tab and at most 16 across tabs may retain guards.
An admission rejection before any native dispatch releases its slot immediately.
Timed-out cleanup stays quarantined until cleanup is verified or its execution
context/page is observably destroyed. No automatic kill, thaw, reload or debugger
reattachment follows a timeout. The operation remains unavailable while debugger ownership conflicts
with inspection or recording operations.
