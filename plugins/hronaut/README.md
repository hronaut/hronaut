# Hronaut for Claude Code

Connects your coding agent to [Hronaut](https://hronaut.dev) — a visible desktop browser it can drive over MCP. Watch every step, pause and take over, keep logins between sessions. Requires the Hronaut app (free 10-day trial at [hronaut.dev](https://hronaut.dev/download)).

The plugin adds Hronaut's MCP server and the Hronaut skill, which teaches the agent to work in its own isolated workspace and hand sign-ins and CAPTCHAs to you.

Through Hronaut's tools the agent opens tabs in its own workspace, reads pages, clicks and types, takes screenshots, inspects console and network traffic, and runs accessibility and performance audits. Hronaut also has wallets for testing dApps: by default Hronaut asks you to approve each wallet request, and automatic approval is a bounded opt-in you turn on per wallet, site and network.

## Examples

- "Open http://localhost:3000/signup in Hronaut, sign up with test data, and report console errors and failed requests."
- "Check the checkout page on our staging site in Hronaut at 375 and 1280 pixels wide, take screenshots, and list layout problems."
- "Audit http://localhost:5173/settings for accessibility in Hronaut, fix what you find in the code, and audit again to confirm."
- "Sign in to the admin panel in Hronaut and hand me the 2FA step; then check that the user list loads."

## Install

Start Hronaut, then in Claude Code:

```text
/plugin marketplace add hronaut/hronaut
/plugin install hronaut@hronaut
```

On Claude Code 2.1.275 or later, `/plugin install hronaut --marketplace hronaut/hronaut` does both in one step. `/mcp` shows Hronaut as connected.

## How it connects

The plugin connects to the address in its **Hronaut MCP address** option, `http://127.0.0.1:47812/mcp` by default, which is Hronaut's local endpoint. Each time it connects, `scripts/hronaut-headers.sh` reads the owner token from the token file in Hronaut's profile and passes it to Claude Code's connection, so the token is never written to Claude Code's settings or shown to the agent. It passes the token only when the address is a port on this computer (`127.0.0.1`, `localhost` or `[::1]`). On Windows, where `sh` is often not on the PATH, `scripts/hronaut-headers.cmd` does the same with Windows PowerShell. Hronaut accepts the connection without a token while its MCP authentication is off. The plugin sends nothing anywhere else and stores nothing.

- Changed Hronaut's MCP port? Change the port in the plugin's **Hronaut MCP address** option, in `/config`.
- Hronaut uses another profile folder? Set `HRONAUT_USER_DATA_DIR` as you do for Hronaut.
- Start Hronaut with `HRONAUT_MCP_TOKEN`? Give Claude Code the same variable. Hronaut then uses it instead of its token file, so delete the profile's `mcp-token` file if an earlier start left one, since the plugin sends the file's token first.
- Added Hronaut with `claude mcp add` before? Claude Code keeps using that server, with the token it stored in its settings, instead of the plugin's. Remove it with `claude mcp remove hronaut --scope user`.

Hronaut runs on your computer, so a cloud-hosted agent cannot reach it. See the [setup guide](https://hronaut.dev/setup) and the [privacy policy](https://hronaut.dev/privacy).

## License

Hronaut and this plugin are source-available under the [Subscription and Trial License](LICENSE). The 10-day trial starts with the first agent tool call, with no credit card required. Ongoing use requires a subscription afterward: $4/month or $24/year per named user (50% off $48).
