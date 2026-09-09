# Starter workflows

Once Hronaut is connected, use these prompts to move from the connection smoke test to a real browser task. Replace each `TARGET_...` placeholder before pasting a prompt. Every recipe starts in a task-owned scratch workspace; do not paste credentials, tokens, or private page data into the agent conversation.

## Before you start

- Create a fresh scratch workspace for each task with `browser_workspaces`. Do not use or inspect the Default workspace, and do not reuse a workspace created by another task.
- If a site should be constrained, configure its allowlist in the trusted Hronaut workspace editor first. Agents cannot change that policy. See the [workspace site-access policy](docs/WORKSPACE_SITE_ACCESS.md).
- Tool titles and safety annotations help MCP clients describe actions, but they are advisory. Review the [MCP tool reference](REFERENCE.md#mcp-tools) before granting broad permissions.
- Keep the private resume capability returned for a workspace private. It grants access to that workspace; it is not a public workspace identifier.

## Choose and check your browser setup

### One persistent project profile

If one project and one browser identity cover your task, try a dedicated persistent profile first. Follow [Playwright MCP's client setup](https://github.com/microsoft/playwright-mcp#getting-started), adding `--user-data-dir` and an absolute path to a new project-specific directory to its server arguments. Use the same directory on the next run. A profile supports one browser instance at a time; use separate directories for concurrent instances ([profile documentation](https://github.com/microsoft/playwright-mcp#user-profile)).

1. Ask the connected agent to open `https://example.com`, set `localStorage.setItem('browser-first-run', 'ready')`, and read that value back.
2. Stop that browser/server cleanly and reconnect with the same directory. Open the same URL and read `localStorage.getItem('browser-first-run')`. Expect `ready`; this checks stored site state, not restoration of the old live tab.
3. Remove the test marker with `localStorage.removeItem('browser-first-run')`.

Use a dedicated test profile for this check, keeping your everyday browser profile separate.

### Named Hronaut workspaces and visible takeover

[Connect your client to Hronaut](README.md#connect-an-mcp-client), then ask:

```text
Using Hronaut, create a new isolated workspace named “Workspace first run” with scratch storage. Open https://example.com in that workspace, take a semantic snapshot, report the heading, and wait. Do not use or copy any existing workspace.
```

1. Confirm the named workspace and Example Domain page are visible. Use **Pause agents** beside **MCP ready** before taking over. Pause blocks new commands; it does not undo dispatched actions or stop later page events. Inspect the current page before continuing.
2. Manually follow the page's link to IANA in Hronaut. Resume agent access, then ask the agent to take a fresh snapshot in the same workspace and report the current page. Expect it to observe your navigation.
3. End the agent conversation while leaving Hronaut open. The workspace remains available in the desktop browser. A different MCP session needs the workspace's private resume capability; its name alone does not grant access. Keep that capability private, and use the [workspace reference](REFERENCE.md#mcp-tools) for resumption and archive behavior.

This checks the visible handoff and independently running browser. Choose it when managing several project identities or continuing scoped work across clients is useful. Website storage is isolated per workspace; application-wide history and bookmarks are not. Pricing and trial terms live in the canonical [License section](README.md#license).

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
