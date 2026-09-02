# Starter workflows

Once Hronaut is connected, use these prompts to move from the connection smoke test to a real browser task. Replace each `TARGET_...` placeholder before pasting a prompt. Every recipe starts in a task-owned scratch workspace; do not paste credentials, tokens, or private page data into the agent conversation.

## Before you start

- Create a fresh scratch workspace for each task with `browser_workspaces`. Do not use or inspect the Default workspace, and do not reuse a workspace created by another task.
- If a site should be constrained, configure its allowlist in the trusted Hronaut workspace editor first. Agents cannot change that policy. See the [workspace site-access policy](docs/WORKSPACE_SITE_ACCESS.md).
- Tool titles and safety annotations help MCP clients describe actions, but they are advisory. Review the [MCP tool reference](REFERENCE.md#mcp-tools) before granting broad permissions.
- Keep the private resume capability returned for a workspace private. It grants access to that workspace; it is not a public workspace identifier.

## Authenticated QA with human handoff

Use this when the target requires a login, CAPTCHA, consent, payment approval, or another step that only a person should complete.

First prompt:

```text
Using Hronaut, follow these instructions. Create a fresh scratch workspace named "Authenticated QA" with `browser_workspaces`. Do not use or inspect the Default workspace. Open TARGET_LOGIN_URL in that workspace with `browser_new_tab`, then use `browser_request_user_attention` to ask me to sign in. Do not enter credentials, solve CAPTCHA, or approve consent. Stop after requesting my attention.
```

Pause MCP in Hronaut before entering anything sensitive. Complete the manual step in the visible browser, then resume MCP and continue in the same connected task. If the client reconnects, resume only the workspace created for this task with its private resume capability.

Follow-up prompt:

```text
Continue in the same authorized Hronaut workspace. Use `browser_snapshot` to inspect the signed-in page, verify TARGET_BEHAVIOR, and report what you observed. Ask before any action that would submit, publish, purchase, delete, or change account data.
```

## Localhost defect triage

Use this to collect a bounded, reproducible first-pass report from a local development server.

```text
Using Hronaut, follow these instructions. Create a fresh scratch workspace named "Localhost QA" with `browser_workspaces`. Do not use or inspect the Default workspace. Open TARGET_LOCAL_URL in that workspace with `browser_new_tab`. Reproduce TARGET_PROBLEM, inspect the current page with `browser_snapshot`, then run `browser_accessibility_audit`, `browser_quality_audit`, and `browser_debug_report`. Use `browser_network_search` only for requests related to the failure. Do not request network bodies unless the failure requires them. Capture the failing state with `browser_screenshot`, then summarize exact reproduction steps and evidence without including secrets or unrelated page content.
```

Network and page evidence can contain private application data even after automatic filtering. Limit the target and evidence requested, and review the result before sharing it.

## Responsive review

Use this for a focused layout check rather than an open-ended visual crawl.

```text
Using Hronaut, follow these instructions. Create a fresh scratch workspace named "Responsive review" with `browser_workspaces`. Do not use or inspect the Default workspace. Open TARGET_URL in that workspace with `browser_new_tab`. Use `browser_resize` to check TARGET_PHONE_WIDTH and TARGET_DESKTOP_WIDTH. At each size, use `browser_snapshot`, `browser_screenshot`, and `browser_design_overview` to inspect TARGET_COMPONENT. Report observable overflow, clipping, unreadable contrast, or missing controls. Reset `browser_resize` to restore the normal viewport when finished.
```

Use `browser_emulate` only when the task requires a specific locale, media preference, network condition, device environment, or diagnostic overlay. Reset the emulation after the check so the tab does not retain surprising conditions.

## What these recipes do not authorize

- They do not authorize access to the Default workspace, another task's workspace, or an everyday browser profile.
- They do not authorize credentials, CAPTCHA answers, consent, payment approval, or secrets in prompts. Pause MCP and take over the visible browser for those steps.
- They do not authorize unrestricted collection of page text, storage, network bodies, or account data.
- They do not authorize state-changing actions beyond the stated test. Ask before submitting forms or mutating application data.
- They do not turn Hronaut into a hosted browser service. Browser state and MCP access remain on the machine running Hronaut.

For the complete tool catalog, inputs, and security notes, use the [MCP tool reference](REFERENCE.md#mcp-tools).
