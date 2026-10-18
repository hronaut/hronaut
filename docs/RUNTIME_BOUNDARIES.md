# Runtime ownership after the architecture review

The first staged extraction is complete around page metadata, Home delivery, and
workspace archive/restore transitions. These boundaries are intentionally narrower
than the entire browser runtime.

- `main/index.ts` composes runtime services and registers trusted IPC through
  per-feature `main/*-ipc.ts` modules, which keep each handler's sender check
  with the handler and read index state through a small host object. The checks
  themselves, which shell document sent a message and whether saved workspaces are
  ready, come from `main/ipc-guards.ts`. Home's dashboard state comes from
  `main/home-dashboard.ts`, and index.ts supplies it through
  `platform/home-protocol.ts`; that protocol owns its assets, MIME types, CSP, and
  status response in Home's separate application session.
  Startup features are controllers built from the same kind of host:
  `main/windows/application-menu.ts`, `main/windows/window-state-persistence.ts`,
  `main/tray-attention.ts`, `main/commercial-license-runtime.ts` and `main/app-updates.ts`.
  Browser sessions, clipboard copies, saved passwords, overlay view surfaces and the
  detached panel window are built the same way: `main/browser-session.ts`,
  `main/clipboard-operations.ts`, `main/credential-runtime.ts`,
  `main/windows/overlay-surfaces.ts` and `main/windows/panel-window.ts`. So are site
  data summaries and clearing, the MCP status and pause, agent presence, the main
  window's chrome and the address suggestions overlay: `main/site-data.ts`,
  `main/mcp-control-state.ts`, `main/agent-presence.ts`, `main/windows/main-window.ts`
  and `main/windows/address-suggestion-overlay.ts`, whose messages
  `main/address-overlay-ipc.ts` checks. Both windows' theme and interface scale,
  bookmarks and visit history, and the services agents use beside the browser come
  from `main/windows/appearance.ts`, `main/bookmarks-and-history.ts` and
  `main/agent-services.ts`. Showing the shell windows, sending them messages and
  asking on the main window, changing the interface language, routing browser
  shortcuts pressed in pages and enabling Chromium's native WebMCP come from
  `main/windows/shell-windows.ts`, `main/interface-language.ts`,
  `main/browser-shortcut-routing.ts` and `main/native-webmcp-switch.ts`. The shell's
  tooltip, agent card and toast overlays and the runtime's orderly shutdown come from
  `main/windows/shell-overlays.ts` and `main/runtime-shutdown.ts`. State that several
  features read or change is one record that index.ts creates once, typed beside its
  owner: `McpRuntimeState` in
  `main/mcp-runtime.ts`, which starts, moves and resets the listener, `SettingsState`
  in `main/settings-runtime.ts`, which loads, commits and publishes settings,
  translates into the interface language and creates the manager of the operating
  system's launch at login setting, `WalletRuntimeState` in
  `main/wallet/runtime.ts`, which starts wallets and admits page and agent requests,
  `UserAttentionState` in `main/tray-attention.ts`, which shows and ends the request
  for the person's attention, `AppQuitState` in `main/app-lifecycle.ts`, whether the
  app is quitting, which the tray, the application menu, the shell IPC, the lifecycle
  events and the main window's close set and the license runtime reads,
  `FollowSuspensionState` in `main/agent-card-overlay.ts`, the shell's request and an
  open agent card, either of which keeps Follow from switching tabs,
  `TabRuntimeState` in `main/tab-runtime-startup.ts`, the
  tab runtime and how far its saved workspaces got in starting, whose module skips
  native browser actions until they are up and shows the recovery notice when their
  metadata is rejected, `CredentialRuntimeState`, `BrowserSessionState` and
  `CommercialLicenseRuntimeState` in the modules that open the password store, the
  profile's session and site permissions, and the license store,
  `BookmarksAndHistoryState`, `AgentServicesState` and `AppUpdatesState` in their
  modules, `MainWindowRefs` in `main/windows/main-window.ts` and `PanelWindowRefs` in
  `main/windows/panel-window.ts`, whose module and IPC take the record itself.
  The only loose variable left in index.ts is whether saved workspace metadata must
  already exist, which its `startRuntime` learns while discarding obsolete browser
  data and its `createWindow` reads; no other feature touches it.
  What the MCP server offers agents is built by the feature that owns it: agents'
  wallets in `main/wallet/runtime.ts`, site data in `main/site-data.ts`, bookmarks
  and history in `main/bookmarks-and-history.ts`, the automation license checks in
  `main/commercial-license-runtime.ts` and agents' view of the attention request in
  `main/tray-attention.ts`; index.ts's `createRuntimeMcpServer` only hands them to
  the server. `main/app-lifecycle.ts` registers the application's events and runs
  index.ts's `startRuntime` once Electron is ready.
- `browser/tabs-manager.ts` remains the **TabRuntime** host: Electron contents,
  navigation generations, input, storage operations, native presentation, and
  persistence. `workspace-registry.ts` owns active/archive identity transitions,
  public archive projections, and restore rollback through narrow runtime ports.
  Its maps are shared only with the host during this staged extraction. Disposal
  occurs after draining operations and closing tabs, never during tab reordering.
- The MCP modules remain the **AutomationGateway**: `mcp/http-server.ts` owns
  transport, authentication, origin checks and rate limits;
  `mcp/browser-mcp-server.ts` and `mcp/workspace-tool-call.ts` own the call
  wrappers; `mcp/server.ts` is their public entry. Existing transport metadata,
  workspace authorization, write leases, pause checks, origin/navigation fences,
  and dispatch receipts retain their central authority. Diagnostic services must
  not reproduce or weaken these checks.
- `wallet/broker.ts` remains the **WalletBroker** host: request, permission,
  connection and timer state, the lifecycle queue, shutdown, lock, provider
  sessions and small shared checks. Each feature is a module of plain functions
  in `wallet/broker/` over an access object the broker builds per call, with
  delegates under the original method names: page calls, page lifecycle, agent
  operations, request records, transaction and message requests, website
  sign-in, account connections, execution, prompt approvals and request list,
  and wallet management. Approvals and policy re-checks stay in its queue.
- `browser/diagnostics/page-metadata-controller.ts` owns one read-only diagnostic
  domain through tab lookup and isolated-world evaluation ports. It retains no
  listeners or debugger session. Closed, replaced, or navigated tabs invalidate
  pending results. A metadata change needs no workspace lifecycle edit.
- `renderer/src/features/diagnostics/page-metadata/` co-locates the shared panel,
  request controller, and race tests. Docked and detached presentations use that
  contract. Unrelated state broadcasts keep results; close/tab/navigation/dispose
  invalidate pending requests. App and the diagnostics host compose the slice.
  Each other diagnostics panel has its own `features/diagnostics/<panel>/` folder;
  `useDiagnosticsController.ts` and `DiagnosticsPanels.vue` beside them compose all.
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
2. Before connecting, ask whether “Ready for agents” proves the client is connected.
   Have the user open the summary and identify listener, client, and probe states.
3. Ask them to stop new agent commands and then block page input. Record whether
   they choose the correct separate controls and understand a settling command.
4. With direct agent access disabled, ask whether an agent can reuse copied
   sign-ins. Compare their prediction with the visible fork/access explanation.
5. Return to an existing profile and locate a workspace without repeating setup.

Record actual observations before claiming improved onboarding time or control
comprehension. No human study or conversion measurement is implied by the tests.
