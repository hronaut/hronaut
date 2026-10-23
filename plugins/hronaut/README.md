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

The plugin connects to `http://127.0.0.1:47812/mcp`, Hronaut's local endpoint. Each time it connects, `scripts/hronaut-headers.sh` reads the owner token from the token file in Hronaut's profile and passes it to Claude Code's connection, so the token is never written to Claude Code's settings or shown to the agent. Hronaut accepts the connection without a token while its MCP authentication is off.

- Changed Hronaut's MCP port? Set `HRONAUT_MCP_PORT` for Claude Code too.
- Hronaut uses another profile folder? Set `HRONAUT_USER_DATA_DIR` as you do for Hronaut.
- A profile that Hronaut only ever started with `HRONAUT_MCP_TOKEN` has no token file, so give Claude Code the same variable.
- Added Hronaut with `claude mcp add` before? Remove it with `claude mcp remove hronaut --scope user`, so the agent does not get Hronaut's tools twice.

Hronaut runs on your computer, so a cloud-hosted agent cannot reach it. See the [setup guide](https://hronaut.dev/setup) and the [privacy policy](https://hronaut.dev/privacy).

## License

Hronaut and this plugin are covered by the [Hronaut license](https://github.com/hronaut/hronaut/blob/main/LICENSE).
