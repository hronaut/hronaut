# React topology inspection

React inspection is off by default. Explicitly enable it for one HTTP(S) tab with
`browser_react` or **React inspection → Enable for this tab** in that tab's context
menu. Enabling returns `reload-required`; it does not navigate or reload the page.
A later normal navigation/reload installs the locally bundled registration hook
before page scripts. Only the top-level document is instrumented. Other tabs,
workspaces, embedded frames and restored application sessions remain off.

## Supported observation

The initial adapter supports the ReactDOM **19.2.4 production** registration and
fiber topology protocol. It reports component names and parent relationships,
including an `anonymous` fallback. Renderer version/package strings and component
names are untrusted page claims, not authenticated provenance. Names can themselves
contain private text. The result does not establish that unobserved components or
private information are absent.

The observer reads only own data descriptors for `current`, `child`, `sibling`,
`tag`, `type`, `displayName`, `name`, `version` and `rendererPackageName`. It rejects
accessors and native remote objects identified as Proxies before inspecting their
descriptors. It does not inspect props, state, context, keys, source locations,
DOM text or host instances. The original frozen API is captured and verified;
page replacement of `globalThis` or descriptor/collection intrinsics does not
redirect the observer. Hook conflicts are preserved, including accessor conflicts;
the existing hook is neither invoked nor overwritten.

## MCP contract

`browser_react` requires `workspaceId`, `tabId` and an explicit `action`:

- `enable`: arm future authorized top-level loads. No automatic navigation.
- `status`: report activation and installation, not a successful topology read.
- `tree`: obtain a fresh bounded observation; optionally pass its `subtreeId`.
- `disable`: stop observations and future installation. The installed hook cannot
  be safely unpatched in a running React document: `disabled-reload-required`
  reports that residue until the next reload. Retained root/renderer registrations
  are cleared and subsequent registration callbacks are ignored.

This is a mixed mutating tool, **not readonly**. All actions currently require the
existing gateway workspace authorization and exclusive write lease. It appears in
QA and complete tool sets. No arbitrary evaluation sentinel or test-only public
API is used.

`disabled`, `reload-required`, `installed-readiness-unchecked` and
`disabled-reload-required` describe activation. A `tree` can return `ready`,
`renderer-not-observed`, `unsupported-renderer`, `hook-conflict`, `root-limit`,
`unavailable`, `interrupted`, `timed-out` or `stale-observation`. Multiple renderer
registrations are unsupported. Unsupported/unavailable is not proof that a page
has no React components. Invalid or stale subtree IDs never fall back to a full
or unrelated tree. Subtree roots have `parent: null`.

Observations bind to workspace/tab identity, permission history, installation,
navigation and observation generations, React commit revision, client authority,
control revision, write lease and capability grant. Same-document navigation
invalidates observation IDs without creating a new installation. Commit, unmount,
new document, pause, revoked/replaced authority, workspace policy roundtrips and
close invalidate earlier IDs. Resume requires a fresh observation. A previously
armed client's authority no longer authorizes future installation after revocation;
re-arm explicitly and reload. Archive restoration, failed-deletion rollback and
application restart do not restore activation.

Credential/grant rotation rejects old sessions and in-flight reads. A new grant
is not permission to take over an active lease. After rotation, the operator may
use normal pause/resume to release a revoked client's lease before authenticated
workspace resume and fresh observation. No policy bypass or private lease takeover
is provided.

## Limits and debugger ownership

The hook retains at most **one renderer** and **16 root registrations**. Traversal
visits at most **256 fibers**, including internal/host fibers, uses maximum depth
**16** (root depth zero), returns at most **80 component nodes**, and bounds each
name to 80 UTF-16 code units. Cycles stop traversal. Partial results set `partial`
and a `limit` of `nodes`, `depth`, `visits`, `bytes`, `cycle` or `time`; omitted
nodes do not imply absence. Returned parent references stay within the result.

The **entire returned MCP CallToolResult JSON**, including pretty-printed text and
outer string escaping, is capped at **16,000 UTF-8 bytes**. This is a returned-data
cap, not a bound on every intermediate Chromium protocol transfer or page heap.
It excludes JSON-RPC/SSE framing. The caller deadline is two seconds.

The observer uses Hronaut's existing debugger queue and attached session. It does
not attach/detach or take ownership from DevTools, coverage or CPU recording.
DevTools already open/opening and recorder ownership produce unavailable or
interrupted observations. A timeout stops waiting; it **does not cancel a native
command**, clear the queue, or permit concurrent native commands. Remote object
groups are released when native work settles, or discarded with a detached
session. Authorization/context checks run after queue admission, through traversal
and before returning output.

## Provenance and tests

The small hook is authored locally; it does not copy or vendor React DevTools.
Its protocol was reviewed against React tag `v19.2.4`, source commit
`90ab3f89f4824ac763b6f877c6f711200d1338d2`:
[registration hook](https://github.com/facebook/react/blob/90ab3f89f4824ac763b6f877c6f711200d1338d2/packages/react-devtools-shared/src/hook.js),
[reconciler integration](https://github.com/facebook/react/blob/90ab3f89f4824ac763b6f877c6f711200d1338d2/packages/react-reconciler/src/ReactFiberDevToolsHook.js),
[MIT license](https://github.com/facebook/react/blob/90ab3f89f4824ac763b6f877c6f711200d1338d2/LICENSE).
The upstream DevTools hook reads additional private state; it is not used here.

Integration fixtures use exact dev-only npm aliases for React/ReactDOM 19.2.4 and
Scheduler 0.27.0, with tarball integrity hashes in `package-lock.json`. A tiny test
loader bundles their local production CommonJS modules deterministically; it does
not fetch a CDN at runtime. Their MIT licenses remain in the installed packages.
No vendored `node_modules` or React runtime is included in the application bundle.
Hostile synthetic fibers exercise the same installed bootstrap and observer as
the real React fixture. Conflict fixtures register a temporary Electron preload
in the isolated test session, not a public application test switch.
