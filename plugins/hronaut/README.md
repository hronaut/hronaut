# Hronaut for Claude Code

Connects your coding agent to [Hronaut](https://hronaut.dev) — a visible desktop browser it can drive over MCP. Watch every step, pause and take over, keep logins between sessions. Requires the Hronaut app (free 10-day trial at [hronaut.dev](https://hronaut.dev/download)).

The plugin adds Hronaut's MCP server and the Hronaut skill, which teaches the agent to work in its own isolated workspace and hand sign-ins and CAPTCHAs to you.

## Install

Start Hronaut, then in Claude Code:

```text
/plugin marketplace add hronaut/hronaut
/plugin install hronaut@hronaut
```

On Claude Code 2.1.275 or later, `/plugin install hronaut --marketplace hronaut/hronaut` does both in one step. `/mcp` shows Hronaut as connected.

## How it connects

The plugin connects to `http://127.0.0.1:47812/mcp`, Hronaut's local endpoint. Each time it connects, `scripts/hronaut-headers.sh` reads the owner token from the token file in Hronaut's profile and passes it to Claude Code's connection, so the token is never written to Claude Code's settings or shown to the agent. On Windows, where `sh` is often not on the PATH, `scripts/hronaut-headers.cmd` does the same with Windows PowerShell. Hronaut accepts the connection without a token while its MCP authentication is off.

- Changed Hronaut's MCP port? Set `HRONAUT_MCP_PORT` for Claude Code too.
- Hronaut uses another profile folder? Set `HRONAUT_USER_DATA_DIR` as you do for Hronaut.
- Start Hronaut with `HRONAUT_MCP_TOKEN`? Give Claude Code the same variable. Hronaut then uses it instead of its token file, so delete the profile's `mcp-token` file if an earlier start left one, since the plugin sends the file's token first.
- Added Hronaut with `claude mcp add` before? Claude Code keeps using that server, with the token it stored in its settings, instead of the plugin's. Remove it with `claude mcp remove hronaut --scope user`.

Hronaut runs on your computer, so a cloud-hosted agent cannot reach it. See the [setup guide](https://hronaut.dev/setup) and the [privacy policy](https://hronaut.dev/privacy).

## License

Hronaut and this plugin are source-available under the [Subscription and Trial License](LICENSE). The 10-day trial starts with the first agent tool call, with no credit card required. Ongoing use requires a subscription afterward: $4/month or $24/year per named user (50% off $48).
