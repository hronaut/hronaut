# Runtime ownership after the architecture review

The first staged extraction is complete around page metadata, Home delivery, and
workspace archive/restore transitions. These boundaries are intentionally narrower
than the entire browser runtime.

- `main/index.ts` composes runtime services and registers trusted IPC. It supplies
  Home data through `platform/home-protocol.ts`; that protocol owns its assets,
  MIME types, CSP, and status response in Home's separate application session.
- `browser/tabs-manager.ts` remains the **TabRuntime** host: Electron contents,
  navigation generations, input, storage operations, native presentation, and
  persistence. `workspace-registry.ts` owns active/archive identity transitions,
  public archive projections, and restore rollback through narrow runtime ports.
  Its maps are shared only with the host during this staged extraction. Disposal
  occurs after draining operations and closing tabs, never during tab reordering.
- `mcp/server.ts` remains the **AutomationGateway**. Existing transport metadata,
  workspace authorization, write leases, pause checks, origin/navigation fences,
  and dispatch receipts retain their central authority. Diagnostic services must
  not reproduce or weaken these checks.
- `browser/diagnostics/page-metadata-controller.ts` owns one read-only diagnostic
  domain through tab lookup and isolated-world evaluation ports. It retains no
  listeners or debugger session. Closed, replaced, or navigated tabs invalidate
  pending results. A metadata change needs no workspace lifecycle edit.
- `renderer/src/features/diagnostics/page-metadata/` co-locates the shared panel,
  request controller, and race tests. Docked and detached presentations use that
  contract. Unrelated state broadcasts keep results; close/tab/navigation/dispose
  invalidate pending requests. App and the diagnostics host compose the slice.
- `renderer/src/home/` owns typed Home interactions and their disposal. The main
  process supplies escaped bootstrap data and the static document; the narrow
  `HronautHomeApi` authorizes native actions. Home imports shared semantic theme
  tokens and keeps workspace elements stable during polling.

Follow these boundaries for subsequent diagnostic slices and runtime services.
Extract cohesive resource owners through typed ports rather than adding forwarding
layers. Electron/native behavior remains covered by the immutable Docker gate,
including pause/ownership, cross-workspace isolation, restart, and native dialogs.

## Review delivery scope

The staged A4/A6 exit criteria are the independent metadata service and complete
renderer slice, plus the workspace archive/restore owner. Other diagnostic
domains and TabRuntime services can follow this pattern incrementally. This
delivery does not claim a wholesale decomposition of TabsManager or the MCP
gateway. Their authority checks and resource ownership remain centralized.

For A5, Home interaction logic is bundled TypeScript checked by the renderer
project. Its escaped static document is still rendered by main, and small
dynamic templates live in typed controllers. A Vue conversion is not required
for this boundary: the application partition, narrow preload bridge, shared
theme tokens, disposal, and stable polling behavior are the contract.

## Human usability validation still to record

The automated `connection-journey.e2e.ts` covers setup copying, a real initialized
MCP client, a benign fixture-page snapshot, keyboard dismissal/focus restoration,
and pause/resume. Its recorded duration measures test execution, not usability.
`home-startup-continuity.e2e.ts` holds the real HTTP listener startup, edits Home,
then verifies that readiness updates preserve the document, draft, and focus.
Complete D1/D4's observed-user criteria in a fresh disposable profile:

1. Ask a first-time user to connect their chosen local client and report a heading
   from a benign page. Record time from launch to the verified snapshot, errors,
   help requests, and successful recovery from a copy failure.
2. Before connecting, ask whether “MCP ready” proves the client is connected.
   Have the user open the summary and identify listener, client, and probe states.
3. Ask them to stop new agent commands and then block page input. Record whether
   they choose the correct separate controls and understand a settling command.
4. With direct agent access disabled, ask whether an agent can reuse copied
   sign-ins. Compare their prediction with the visible fork/access explanation.
5. Return to an existing profile and locate a workspace without repeating setup.

Record actual observations before claiming improved onboarding time or control
comprehension. No human study or conversion measurement is implied by the tests.
