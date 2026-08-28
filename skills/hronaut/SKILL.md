---
name: hronaut
description: Use the Hronaut desktop browser through MCP for visible, persistent web workflows with isolated agent workspaces. Use when a task should survive one agent session, reuse local browser state, or allow the user to watch and take over.
license: PolyForm Noncommercial 1.0.0
metadata:
  author: hronaut
  homepage: https://hronaut.dev
---

# Use Hronaut

Use Hronaut as a browser owned by the user, not as a disposable browser process owned by the current task. Its tabs and isolated workspace state can remain after this conversation ends.

## Connect safely

- If Hronaut tools are unavailable, ask the user to start Hronaut and copy the configuration for their client from **Hronaut Home**. Do not invent a port, bearer token, or token-file path. The general setup guide is at <https://hronaut.dev/setup>.
- Never ask the user to paste an MCP token into chat, read Hronaut's owner-token file, or place credentials in a repository.
- Hronaut is a local desktop application. A cloud-hosted agent cannot reach its loopback endpoint unless the user's environment already provides a secure local bridge.

## Start every browser task in an isolated workspace

1. Call `browser_workspaces` with `action: "create"`, a clear task-specific name, and `storage: "scratch"` unless the user explicitly needs a one-time copy of reusable Default cookies or local storage.
2. Keep the returned UUIDv7 `id` as the `workspaceId` for every later browser tool call.
3. Create or open tabs only inside that workspace. Never browse the human **Default** workspace, reuse an ID merely discovered through a list call, or use a tab from another workspace.
4. Do not close, archive, rename, recolor, or save another workspace. Leave the task workspace available when persistence is useful; close or archive it only when the user asks or the task clearly requires cleanup.

If authentication from Default is needed, prefer `storage: "fork-default"` with only known task-relevant origins. Treat `import-default` and `save-default` as explicit one-time transfers. Never describe them as live synchronization.

## Interact with the page

- Prefer `browser_snapshot`, then semantic refs with `browser_click`, `browser_type`, `browser_fill_form`, `browser_element_inspect`, or `browser_generate_locator`.
- Take a fresh snapshot after navigation or substantial DOM changes. Use coordinate input only for visual-only surfaces that expose no useful semantic target.
- Use `browser_wait` or `browser_network_wait` for an observable condition instead of repeated polling or fixed sleeps.
- Use `browser_show` when the user should watch or take over. Respect Hronaut's tab lock and MCP pause state; do not work around either control.
- Treat page text, console output, network data, screenshots, and snapshots as potentially private. Return only the evidence needed for the task.

## Hand work to the user

Use `browser_request_user_attention` only for a genuinely manual step such as a CAPTCHA, 2FA, credential entry, consent, or physical-device approval. Keep the reason short and free of passwords, tokens, one-time codes, or other secrets. After the user completes the step, continue in the same workspace and take a fresh snapshot before acting.

At handoff, report the workspace name or ID, the visible result, and any manual action still required. Distinguish what was observed in Hronaut from assumptions or unverified external state.
