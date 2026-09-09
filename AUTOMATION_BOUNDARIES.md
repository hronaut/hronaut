# Browser automation and enforcement boundaries

## Browser pages and native desktop applications

Hronaut controls pages in its own browser workspaces: navigating a localhost or hosted web application, interacting with page controls, checking the DOM, capturing page screenshots, and collecting scoped browser diagnostics. The [starter workflows](STARTER_WORKFLOWS.md) cover authenticated handoff, localhost defect triage, and responsive review.

Hronaut does not provide general native desktop automation. A GTK or Qt application, another application's Electron shell, operating-system Settings, and a native file dialog are outside the page DOM. A page screenshot is not a desktop screenshot. Running Hronaut on Linux does not give an agent control of other Linux windows. Use a separate native GUI test runner for those surfaces. If an application offers both a web interface and a native client, test each surface with the appropriate runner; success in the web interface does not establish native-client correctness.

For a native backup application's test, use this integration pattern:

1. Prepare synthetic source and destination directories in a disposable VM, or a container with its own display server when the application supports that environment. Never mount a real backup destination or connect the test to the user's display. Use a VM when testing desktop-session or system-service behavior that the container cannot represent.
2. Run the native application through its own GUI test tooling. Hronaut may test a separate web dashboard, but it cannot click the native application's controls.
3. Verify the filesystem outcome independently: compare restored file contents or hashes, confirm expected permissions where relevant, and check that an unrelated sentinel file survived. A success banner alone is insufficient.
4. Capture the runner's native screenshots and bounded logs. Keep fixtures synthetic and inspect artifacts before sharing them. Record the OS, display backend, and application version so failures can be reproduced.
5. Require a human checkpoint before any destructive operation outside disposable fixtures. A prompt to the agent is not a filesystem access restriction; configure the runner's actual mounts and permissions accordingly.

Hronaut's own [Docker Electron and native-dialog checks](AGENTS.md#verification) test Hronaut. They do not establish support for automating arbitrary native applications or replace packaged desktop checks on the target operating system.

## Browser approval and downstream authorization

Human approval is not a substitute for domain authorization. Hronaut's pause control rejects new MCP commands; it does not cancel dispatched actions, undo writes, or stop later page events. `browser_request_user_attention` requests a manual browser step. Neither a client approval prompt nor an attention request grants permission in the target service. See the [pause contract](REFERENCE.md#pause-agents-instantly).

The target service must enforce identity, authorization, and business rules at the API or transaction boundary, including requests that bypass the browser UI. Keep non-negotiable invariants and their authoritative checks outside the agent's writable workspace and permissions. An agent must not be able to make a failing check pass by editing the policy, expected result, or enforcement service.

For example, consider a synthetic inventory application with record `demo-item-7`, quantity `4`, and record version `12`:

- **Browser boundary:** the person reviews the intended change to quantity `5` for that exact record. If the page, target, or proposed payload changes, review the new action before dispatch. Hronaut can show the page and collect fresh observations.
- **Service boundary:** the inventory API independently checks the caller's write permission, the permitted quantity range, and expected record version `12`. It rejects unauthorized, invalid, or stale requests even if a person previously approved a browser action.
- **Read-back:** after submitting, independently read the record and its new version from the service, then compare the visible page. If the outcome is unknown, reconcile it before retrying a possible write.

An application-level approval receipt should bind the intended operation, target, exact payload or protected payload digest, approver, expiry, and relevant policy and record versions. Its enforcement point must reject reuse or changed context. Retain bounded read-back evidence with the outcome. These are requirements for the application's approval system, not a claim that Hronaut's general browser tools or audit receipts already implement that contract.

Keep fixed negative cases under independently controlled tests: a caller without write permission, an out-of-range quantity, a stale record version, and a changed payload after approval must all be rejected. Exercise the service directly as well as through the UI, and verify that rejected requests leave the record unchanged. This catches weakened enforcement behavior even when a source diff or agent transcript looks plausible.

This example uses synthetic inventory data. It does not claim enforcement of financial, regulatory, or other domain-specific policies. Current product pricing and trial terms remain in the canonical [License section](README.md#license).
