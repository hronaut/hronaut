/**
 * How one MCP tool call runs, in order. Names in backticks are the members declared below; one a tool omits is skipped.
 * 1. McpHttpServer (http-server.ts) checks the token or capability credential (401), local Origin (403/400), the HTTP
 *    method (405), pause (503), the active-request limit (429) and the session (404 unknown, 401 another credential,
 *    400 missing), names the client and builds a new session's MCP server.
 * 2. The MCP SDK refuses a tool outside the session's tool set or capability profile ("disabled") and arguments that
 *    fail its schema (a workspace tool's: workspaceId, reviewId and reviewRevision plus its fields, or `inputSchema`).
 * 3. registerToolWithSettlement (browser-mcp-server.ts) wraps every tool. trackAgentCall shows the step in the
 *    workspace's toolbar, named by `stepTarget`. The call's `settlement` is created; `admit` may return a result.
 * 4. It checks agent control (requireTabAgentControl; one tab only for `singleTabControl` or `tabTarget` not 'none'),
 *    the capability at admission (capability-decision.ts; `pageOrigins` picks the pages named), the license, the write
 *    lease (`leaseTarget` names or claims the workspace; a non-read call not `leaseExempt` starts beginMutation),
 *    then consumes a capability use and checks the license and agent control again. A failure goes to `settleError`
 *    or errorResult (tool-results.ts); a capability denial also invalidates the approved review named by reviewId.
 * 5. actionTracker.run counts the call as active and runs the handler. A workspace tool's handler is the wrapper from
 *    createWorkspaceToolRegistrar (workspace-tool-call.ts) inside tool(), which turns what the wrapper throws into
 *    errorResult, except native-input errors and the emulation and storage input errors.
 * 6. The workspace wrapper requires workspaceId and both review fields or neither, strips the review fields, applies
 *    `normalizeArguments`, reads `readOnly` and `continuityInspection`, then checks the capability for dispatch, the
 *    caller's own workspace, the write lease when the call needs one, `publicObserverAllowed`, no pending human
 *    decision (HumanWaitingService.requireDispatch) and continuity; `continuityInspection` skips the last two.
 * 7. It resolves the tab by `tabTarget` (without selecting it when `preservesPresentation`), records the authority of
 *    a destructive action, checks that `postcondition` has an audit run and that `reconciliation` matches it, and
 *    passes the admitted call to `prepare`. A failure in steps 6 and 7 throws.
 * 8. A browser_* call runs through AuditReceiptService.execute: during an audit run, AuditReceiptRun saves a decision
 *    receipt before the operation and evidence and outcome receipts after it. Other calls run the operation directly.
 * 9. The operation checks the recorded authority (a change returns POLICY_REJECTED, UNTRUSTED_TARGET or
 *    STALE_PRECONDITION) and the target, reads `reconciliation` (which may end the call), starts the tab activity of
 *    a `tabActivityToolName` handler, marks a continuity read or write, and wakes the tab when the handler's
 *    `resolvedTargetWakePolicy` is 'before-handler' (the default) unless `preservesPresentation`.
 * 10. It repeats the human decision, authority and target checks, begins the reviewed attempt when there is a review,
 *    runs `certify` and `beforeDispatch`, calls the handler with the resolved tabId, then runs `afterDispatch`.
 * 11. It checks that the action's authority held during dispatch, then the human decision, `recheckAfterDispatch`, a
 *    worker observation's origin (validateLifecycle), the lease generation, the control revision, the workspace,
 *    human input and the tab again (`closesTargetTab` skips agent control, human input and the tab). A failure
 *    discards the result as STALE_OBSERVATION when read-only, else OUTCOME_UNKNOWN; a native-input error gives an
 *    outcome-unknown result. The result's browser state is then scoped to the workspace.
 * 12. After the outcome receipt, a succeeded call with `postcondition` is read back (postWriteVerification). A reviewed
 *    attempt ends 'verified' after a verified read-back and 'unknown' after an unknown one or an error result.
 *    `finalize` runs (audit path only) and the tab activity ends through `deferActivity` and `classifyActivity`. A
 *    thrown error ends it as failed, except that a `waitsOnTab` call whose tab closed returns STALE_OBSERVATION.
 * 13. registerToolWithSettlement checks the capability for dispatch again (`capabilityInput`); a denial returns
 *    `publicationRevoked`, `settleDenied`, or STALE_OBSERVATION / OUTCOME_UNKNOWN. Then `publish` may settle the
 *    result and `recordsReadiness` records the readiness probe; a throw goes to `settleError` or errorResult.
 * 14. Finally `dispose` runs and the lease mutation ends, after `pendingCompletion` when there is one. trackAgentCall
 *    marks the step finished or failed, the SDK checks any output schema, and the HTTP response is sent.
 */
import type { RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AnySchema, ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { McpTabActivity, UserAttentionInput, UserAttentionRequest } from '../../../shared/types.js'
import type { Browser } from '../../browser/browser.js'
import type { listMcpTabGroups, requireMcpTabGroup } from '../../browser/mcp-tab-groups/mcp-tab-groups.js'
import type { UserAttentionLifecycle } from '../../attention/user-attention-lifecycle.js'
import { McpActionTracker } from '../action-tracker.js'
import type { AuditReceiptService } from '../audit-receipt-service.js'
import type { AuditReceiptAuthorization } from '../audit-receipt-store.js'
import type { McpCapabilityGrant, McpCapabilityProfile, McpCapabilityProfileStore } from '../capability-profile-store.js'
import type { HumanWaitingService } from '../human-waiting-service.js'
import type { TaskRunService } from '../task-run-service.js'
import type { PostWriteRequest, PreWriteReconciliationRequest } from '../tool-schemas.js'
import { WorkspaceWriteLeaseRegistry } from '../workspace-write-leases.js'
import type { BookmarkOperations, HistoryOperations, SiteDataOperations } from '../browser-data-operations.js'
import type { McpClientActivity } from '../http-server.js'
import type { WalletAgentOperations, WalletAgentSessionRegistry, WalletAgentToolTarget } from '../wallet-agent-sessions.js'

export type ResolvedTargetWakePolicy = 'before-handler' | 'handler-owned' | 'never'

/**
 * One admitted workspace tool call, passed to the tool's handler next to its input. It carries the call's
 * target and cancellation signal, and the checks the workspace wrapper (workspace-tool-call.ts) ran before
 * dispatch, so a tool can repeat them before each step that acts on the page or publishes a result.
 */
export interface WorkspaceToolCall<S = undefined> {
  /** The call's arguments without its review binding, as the capability and review checks saw them. */
  input: Record<string, unknown>
  workspaceId: string
  /** The tab the call resolved to; undefined for tools that act on the whole workspace. */
  tabId: string | undefined
  signal: AbortSignal | undefined
  /** The MCP control revision when the call was admitted. */
  controlRevision: number
  /** The write lease generation the call holds, when it needs one. */
  writeLeaseGeneration: string | undefined
  /** Throws unless the lease, capability, workspace, control, human input and tab are still the admitted ones. */
  requireCurrentTarget: () => void
  /** Throws when a requested postcondition's page context changed since admission. */
  requirePostWriteContext: () => void
  /** Throws when MCP control changed since admission. */
  requireCurrentControl: (settled?: boolean) => void
  /** Throws when a person used the target page since admission. */
  requireCurrentHumanInput: () => void
  /** A rejection when a destructive action's recorded authority no longer holds, else undefined. */
  authorityRejection: () => CallToolResult | undefined
  /** Records a capability or input denial so the call's settlement can report it. */
  rememberInputPolicy: (error: unknown) => void
  /** Whether a failure from here on leaves the call's effects unknown, for its activity and audit record. */
  setInvalidatedOutcome: (outcome: 'outcome-unknown' | undefined) => void
  /** Checks authority for a service worker origin the recorder observed, and re-checks it when the call settles. */
  validateLifecycle: (origin: string) => void
  /** The tool's own bookkeeping for this call, from its `settlement` option. */
  settlement: S
}

/** How a finished call's tab activity is classified: as a read, whether it dispatched, and whether its outcome is known. */
export interface ToolActivityClassification {
  readOnly: boolean
  dispatched: boolean
  invalidatedOutcome: 'outcome-unknown' | 'stale-observation' | 'provenance-rejected' | undefined
}

/**
 * A tool's own bookkeeping for one call, when its result needs more than the shared wrappers settle for every tool:
 * a publication guard, a pending capture, dispatch progress. The wrapper creates it before admission from the
 * tool's `settlement` option and calls each hook at a fixed point. A hook that returns undefined leaves the
 * shared handling in place.
 */
export interface ToolCallSettlement {
  /** When set, every target check fails with this message once the call is cancelled. */
  cancelledMessage?: string
  /** When true, the capability re-check in every target check names the call's workspace and resolved tab. */
  authorizesResolvedTab?: boolean
  /** Runs first in the settled call: throws to reject the input, or returns a result to settle without dispatch. */
  admit?(): CallToolResult | undefined
  /** Sets up the call's guards once it is admitted to its workspace target. */
  prepare?(call: WorkspaceToolCall<unknown>): void
  /** Checks the tool's own conditions after dispatch, with the shared post-dispatch checks. */
  recheckAfterDispatch?(): void
  /**
   * Holds the call's tab activity until the tool settles its result: returns true to keep `finish` and call it
   * with the settled result later, or false to let the activity finish now.
   */
  deferActivity?(finish: (result: CallToolResult) => void): boolean
  /** The input that the capability re-check after the handler authorizes, when it differs from the call's. */
  capabilityInput?(input: Record<string, unknown>): Record<string, unknown>
  /**
   * Settles a result whose capability or lease re-check after the handler failed, before the shared denial
   * handling, or returns undefined.
   */
  publicationRevoked?(error: unknown, result: CallToolResult): CallToolResult | undefined
  /** Records a capability or input denial for the tool's own result. */
  rememberInputPolicy?(error: unknown): void
  /** The capability or input denial the tool recorded, for results the shared handling builds. */
  inputPolicy?(): Record<string, unknown> | undefined
  /**
   * Obtains the tool's own dispatch certificate once the call's review is settled, from `certifyDispatch`, or
   * undefined when this server has no human-waiting authority.
   */
  certify?(certifyDispatch: (() => Promise<() => void>) | undefined): Promise<void>
  /** Runs right before the handler, after every check that admits the dispatch. */
  beforeDispatch?(): void
  /** Records what the handler returned, before the post-dispatch checks. */
  afterDispatch?(result: CallToolResult): void
  /** Notes that recording the call's human review outcome failed after dispatch. */
  reviewFinalizationFailed?(): void
  /** Whether the tool submitted work that may have had effects, so an error result leaves the outcome unknown. */
  effectsPossible?(): boolean
  /** Adjusts how the call's tab activity is classified, from the tool's own dispatch progress. */
  classifyActivity?(activity: ToolActivityClassification, failed: boolean, result: CallToolResult | undefined): ToolActivityClassification
  /** Settles a result whose capability was withdrawn after dispatch, or returns undefined. */
  settleDenied?(denied: CallToolResult, outcome: Record<string, unknown>): CallToolResult | undefined
  /**
   * Publishes a result that passed every shared check after dispatch, or returns undefined. It may throw to fail
   * the call. A synchronous result is returned without another await, so nothing runs between its last check
   * and publication.
   */
  publish?(result: CallToolResult): CallToolResult | Promise<CallToolResult> | undefined
  /** Settles a call that threw, or returns undefined to report the error as is. */
  settleError?(error: unknown): CallToolResult | undefined
  /** Rewrites the call's final result after its review is recorded, just before its tab activity finishes. */
  finalize?(result: CallToolResult): CallToolResult
  /** Work the tool still owns after the call returns; the workspace writer is released only once it settles. */
  pendingCompletion?(): Promise<void> | undefined
  /** Releases what the call retained, however it ended. */
  dispose?(): void
}

/** What any tool may declare about its calls, for the shared wrapper in browser-mcp-server.ts that admits and settles them. */
export interface ToolOptions<S extends ToolCallSettlement | undefined> {
  /** Creates the tool's bookkeeping for one call, or undefined when this call needs none. */
  settlement?: (input: Record<string, unknown>) => S
  /** Whether this call's outcome becomes the client's latest readiness probe. */
  recordsReadiness?: (input: Record<string, unknown>) => boolean
  /**
   * Which pages the call's capability check names besides the addresses in its arguments. 'none': no page.
   * 'all-tabs': every tab in its workspace. Omitted: its target tab, or the workspace's selected tab.
   */
  pageOrigins?: 'none' | 'all-tabs'
  /** Agent control is checked for the call's tab, not the whole browser. Workspace tools with a tab target get this. */
  singleTabControl?: boolean
  /**
   * What the call acts on, for the plain-words step the shell shows: a page address it opens, or a control it names
   * by snapshot ref. The shell shows only Hronaut's own name for that control or the address's host and path.
   */
  stepTarget?: (input: Record<string, unknown>) => { url: unknown } | { ref: unknown }
  /** Whether this call needs no workspace write lease although it may change state, such as an observation or wallet call. */
  leaseExempt?: (input: Record<string, unknown>) => boolean
  /**
   * The workspace whose write lease the call takes when it has no workspaceId argument. saved: the call opens or
   * deletes that saved workspace, so it is checked against saved workspaces and claimed when unclaimed.
   */
  leaseTarget?: (input: Record<string, unknown>) => { workspaceId: unknown; saved: boolean }
  /**
   * The call may run while another call of the same client changes the workspace; it still needs that client's write
   * lease. Only answering a website dialog declares it: the dialog holds the other call's page, so that call ends only
   * once the dialog is answered.
   */
  alongsideWorkspaceChange?: boolean
}

/** What a workspace tool may also declare about its calls, for the workspace wrapper in workspace-tool-call.ts. */
export interface WorkspaceToolOptions<S extends ToolCallSettlement | undefined> extends ToolOptions<S> {
  /** Whether a call with this input only reads, for a tool not annotated read-only. */
  readOnly?: (input: Record<string, unknown>) => boolean
  /**
   * A read-only public observer workspace still allows this tool, although it is not annotated read-only.
   * Only browser_* tools can use this; wallet tools stay denied to public observers whatever they declare.
   */
  publicObserverAllowed?: boolean
  /**
   * Whether this call must leave the page as the person sees it: it does not select or wake its tab, and its
   * activity does not make the window follow it.
   */
  preservesPresentation?: (input: Record<string, unknown>) => boolean
  /** The bounded read-only checks this call asks for after its write, for a tool that offers them. */
  postcondition?: (input: Record<string, unknown>) => PostWriteRequest | undefined
  /** The lookup this call asks to repeat immediately before its write, for a tool that offers it. */
  reconciliation?: (input: Record<string, unknown>) => PreWriteReconciliationRequest | undefined
  /**
   * Which tab the call acts on. 'none': the workspace itself, never a tab. 'optional': a tab only when the call
   * names one. 'if-any': the named or selected tab, or none when the call names no tab and the workspace has none.
   * Omitted: the named or selected tab, which must exist.
   */
  tabTarget?: 'none' | 'optional' | 'if-any'
  /**
   * Whether this call only inspects, so it stays available while the workspace waits on a human decision or a
   * continuity reconciliation. Only explicit inspection operations declare it; client-supplied annotations and
   * arbitrary evaluation never count as inspection.
   */
  continuityInspection?: (input: Record<string, unknown>) => boolean
  /** The tool closes its target tab, so the checks after dispatch no longer require that tab, its human input or agent control of it. */
  closesTargetTab?: boolean
  /** The call waits on its tab, so a tab closed while it waits settles as a closed-tab wait result. */
  waitsOnTab?: boolean
  /** The tool's full input schema, built from its fields, when a plain object of them is not strict enough. */
  inputSchema?: (shape: Record<string, z.ZodType>) => z.ZodObject<Record<string, z.ZodType>>
  /** Normalizes the call's arguments before its review binding and dispatch, or throws to reject them. */
  normalizeArguments?: (args: Record<string, unknown>) => Record<string, unknown>
}

export type WorkspaceToolHandler<T, S = undefined> = ((input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult>) & {
  resolvedTargetWakePolicy?: ResolvedTargetWakePolicy
  tabActivityToolName?: string
}

/**
 * What a tool's registration may use from the MCP server it is registered on: the browser, the calling client,
 * its authorizations, and the shared wrappers that admit, guard and settle each call (see browser-mcp-server.ts and workspace-tool-call.ts).
 */
export interface McpToolContext {
  manager: Browser
  client: McpClientActivity
  bookmarks: BookmarkOperations
  history: HistoryOperations
  siteData: SiteDataOperations
  wallets: WalletAgentOperations | undefined
  auditReceipts: AuditReceiptService | undefined
  humanWaiting: HumanWaitingService | undefined
  taskRuns: TaskRunService | undefined
  userAttentionLifecycle: UserAttentionLifecycle | undefined
  capability: { store: McpCapabilityProfileStore; grant: McpCapabilityGrant } | undefined
  capabilityProfile: McpCapabilityProfile | undefined
  auditAuthorization: AuditReceiptAuthorization
  /** Fingerprint of this server's capability grant, or of full access without one. */
  capabilityAuthorizationFingerprint: string
  humanReviewSessionBinding: string
  publicOutcomeFingerprintKey: Buffer
  savedTaskPreviewKey: Buffer
  activeWorkspaceIds: Set<string>
  savedWorkspaceIds: Set<string>
  workspaceToolInputSchemas: Map<string, z.ZodObject<Record<string, z.ZodType>>>
  actionTracker: McpActionTracker
  workspaceLeases: WorkspaceWriteLeaseRegistry
  showWindowInactive: () => void
  getPaused: () => boolean
  getUserAttention: () => UserAttentionRequest | null
  requestUserAttention: (request: UserAttentionInput) => Promise<UserAttentionRequest>
  onTabActivity: ((activity: McpTabActivity, workspaceId: string) => void) | undefined
  registerTool: <OutputArgs extends ZodRawShapeCompat | AnySchema, InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(name: string, config: {
    title?: string
    description?: string
    inputSchema?: InputArgs
    outputSchema?: OutputArgs
    annotations?: ToolAnnotations
    _meta?: Record<string, unknown>
  }, cb: ToolCallback<InputArgs>, options?: ToolOptions<ToolCallSettlement | undefined>) => RegisteredTool
  registerWorkspaceTool: <T extends object, S extends ToolCallSettlement | undefined = undefined>(name: string, config: {
    description?: string
    inputSchema?: Record<string, z.ZodType>
  }, handler: WorkspaceToolHandler<T, S>, options?: WorkspaceToolOptions<S>) => void
  tool: <T, E = { signal?: AbortSignal }>(handler: (input: T, extra: E) => Promise<CallToolResult> | CallToolResult) => (input: T, extra: E) => Promise<CallToolResult>
  tabTool: <T, S = undefined>(
    toolName: string,
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult> | CallToolResult,
    resolvedTargetWakePolicy?: ResolvedTargetWakePolicy
  ) => WorkspaceToolHandler<T, S>
  withResolvedTargetWakePolicy: <T, S = undefined>(
    handler: (input: T, call: WorkspaceToolCall<S>) => Promise<CallToolResult>,
    resolvedTargetWakePolicy: ResolvedTargetWakePolicy
  ) => WorkspaceToolHandler<T, S>
  requireActiveCapabilityDispatch: (
    name: string,
    input: Record<string, unknown>,
    target?: { workspaceId: string; tabId?: string; origins?: string[] }
  ) => McpCapabilityProfile | undefined
  capabilityAllowsUrl: (profile: McpCapabilityProfile | undefined, url: string) => boolean
  requireAgentWorkspace: (workspaceId: string) => ReturnType<typeof requireMcpTabGroup>
  requireSavedWorkspace: (workspaceId: string) => void
  authorizeResume: (workspaceId: string, resumeKey: string, saved: boolean) => void
  authorizedActiveWorkspaces: () => ReturnType<typeof listMcpTabGroups>
  authorizedSavedWorkspaces: () => ReturnType<Browser['listSavedTabGroups']>
  workspaceAuthorizationError: () => Error
  withResumeKey: <T extends { id: string }>(workspace: T) => T & { resumeKey: string }
  forkOnlySource: (source: ReturnType<Browser['listWorkspaceForkSources']>[number]) => ReturnType<Browser['listWorkspaceForkSources']>[number] & {
    forkOnly: true
    forkWith: { action: 'create'; storage: 'fork-workspace'; sourceWorkspaceId: string }
  }
  leaseLostAfterDispatch: (error: unknown) => CallToolResult
  reviewedActionArguments: (input: Record<string, unknown>, toolName?: string) => Record<string, unknown>
  requireWallets: () => WalletAgentOperations
  requireWalletSessions: () => WalletAgentSessionRegistry
  walletTarget: (walletSessionId: string, workspaceId: string, tabId: string) => WalletAgentToolTarget
}
