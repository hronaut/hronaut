# Scheduled and triggered browser workflow

This reference shows how an external scheduler can hand one bounded task to an
agent and Hronaut without making an agent prompt the workflow database. It runs
against disposable loopback pages in Docker and exports a closed,
privacy-safe lifecycle report.

Run it from a clean checkout with Docker available:

```bash
npm ci
npm run example:scheduled-browser-task:docker
```

The command launches the real Hronaut Electron application in the pinned
Docker/Xvfb image. It writes
`test-results/scheduled-browser-task/report.json`. The scenarios cover fresh
and stale browser context, reconnect, authentication loss, an expired human
review, cancellation before dispatch, a recoverable read, and a possible write
whose browser result is ambiguous until independent target read-back.

## Ownership boundary

| State or decision | Owner |
| --- | --- |
| Trigger time, stable logical item key, job attempts, cancellation and retry budget | External scheduler or event consumer |
| Planning, drafts and selection of the next bounded browser operation | Calling agent |
| Named local workspace/profile, current account/origin/tab, browser dispatch, pause and visible human takeover | Hronaut |
| Record version, business authorization and final persisted outcome | Target system |

Hronaut does not schedule jobs. A scheduler acknowledgement does not mean an
agent ran, an MCP response does not prove the target accepted a change, and a
success banner does not replace authoritative target read-back.

## State kept outside the prompt

The scheduler should persist a record like this before starting an agent:

```json
{
  "triggerId": "opaque stable trigger UUID",
  "logicalTaskId": "opaque stable item UUID",
  "sessionId": "opaque execution-session UUID",
  "attempt": 1,
  "state": "ready",
  "workspaceName": "Scheduled inventory review",
  "expectedTargetRevision": "opaque revision or fingerprint",
  "deadline": "bounded timestamp",
  "retryBudget": 1
}
```

Use opaque identifiers and a revision or fingerprint rather than customer
names, email text, page content, credentials or cookies. Keep the same
`logicalTaskId` for the same business item. Create a new `sessionId` for a new
execution and a new action-attempt ID before each possible dispatch. A model
must not be able to reset the attempt count or rewrite the expected revision by
editing its own prompt.

## One bounded run

1. The scheduler atomically claims the trigger and records its deadline and
   retry budget. Duplicate delivery with the same trigger ID returns the
   existing job instead of starting another browser write.
2. The agent creates or resumes one named Hronaut workspace. Put the task
   purpose and the kind of retained site state in the workspace description.
   Keep the private resume key in the local orchestrator, outside prompts and
   exported receipts.
3. Start `browser_task_runs` with the scheduler's deadline, heartbeat timeout,
   and machine-checkable completion checks. Start `browser_audit_receipts` when
   action evidence is required.
4. Run `browser_preflight` against the expected workspace, tab and origin.
   Read the target record and revision before a write. A missing, changed,
   blocked or unavailable target must be represented explicitly; extraction of
   a candidate is not a precondition check.
5. For a consequential action, request a bounded `browser_human_waiting`
   review or use the application's own approval system. Bind approval to the
   exact target, action, context, expiry and expected postcondition. A same-page
   transition can request two to four exact click steps; follow only the fresh
   `reviewContinuation` returned after each independently verified step.
6. Before a visible system-of-record write, call `browser_reconciliation` with
   the stable logical item, target, source revision, and exact current and
   desired state. Repeat the same condition on `browser_click`; changed,
   missing, blocked, or ambiguous state must stop dispatch, while
   `SKIPPED_ALREADY_PRESENT` means no click occurred.
7. Record a new action-attempt ID, dispatch the browser action once, and retain
   transport acknowledgement separately. Do not automatically repeat a timed
   out or disconnected write.
8. Use a Hronaut postcondition where the visible browser state is authoritative
   enough. Independently read the target system's record and revision when it
   owns the final outcome. Complete the task run as `SUCCEEDED` only after the
   configured checks and authoritative read-back agree.
9. Stop the audit run, persist the sanitized receipt, and let the scheduler mark
   the job terminal. Closing an agent session is not a completion signal.

## Cancellation, reconnect and retry

| Observed state | Scheduler action |
| --- | --- |
| Cancelled before dispatch | Complete the Hronaut task run as `CANCELLED`; do not issue the browser write. |
| Cancelled after a possible dispatch | Preserve possible effects as unknown and perform authoritative read-back. |
| Navigation, workspace control, account, origin, tab or policy changed before dispatch | Invalidate the attempt, capture fresh context and require a new decision. |
| Read-only request failed before any mutation | Retry only within the stored deadline and retry budget after fresh context. |
| Write response timed out, disconnected or contradicted the page | Mark `OUTCOME_UNKNOWN` or `reconciliation_required`; read the target before any retry. |
| Authoritative read-back finds the intended revision | Mark the logical task complete without replaying the write. |
| Authoritative read-back is unavailable or contradictory | Keep the job non-successful and route it to bounded human reconciliation. |

After an MCP reconnect, resume only the named workspace with its private resume
capability, run a fresh preflight, and create a new session/attempt record.
Never reuse an approval or observation from the previous control generation.

## Receipt interpretation

The generated report records deterministic synthetic `triggerId`,
`logicalTaskId`, `sessionId`, and `actionAttemptId` values; the named context
roles; approval, dispatch, transport and postcondition states; initial and final
outcomes; authoritative read-back; and whether retry is allowed. Its ownership
and lifecycle rules are machine-readable so the example can be checked without
relying on prose or an agent transcript.

The report intentionally excludes raw URLs, selectors, page content, cookies,
credentials, MCP tokens, resume keys and live account or customer identifiers.
It is evaluation evidence from synthetic fixtures, not proof that a production
target enforces its own authorization or business rules.

For the tool contracts used here, see [bounded task runs](REFERENCE.md#track-bounded-task-runs),
[action audit receipts](REFERENCE.md#record-action-audit-receipts), and
[browser approval and downstream authorization](AUTOMATION_BOUNDARIES.md#browser-approval-and-downstream-authorization).
