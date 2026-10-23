# Hronaut

Connects your coding agent to [Hronaut](https://hronaut.dev) — a visible desktop browser it can drive over MCP. Watch every step, pause and take over, keep logins between sessions. Requires the Hronaut app (free 10-day trial at [hronaut.dev](https://hronaut.dev/download)).

This extension adds Hronaut's MCP server to the editor, so agents such as GitHub Copilot's agent mode can use it without an `mcp.json` entry.

## Use it

1. Install and start [Hronaut](https://hronaut.dev/download).
2. Install this extension. Hronaut appears in the editor's MCP servers (**MCP: List Servers**).
3. Ask the agent to use Hronaut, for example: “Using Hronaut, create a new isolated workspace, open https://example.com and tell me the page heading.”

## How it connects

The extension connects to `http://127.0.0.1:47812/mcp`, Hronaut's local endpoint. When the editor starts the server, the extension reads Hronaut's owner token from `HRONAUT_MCP_TOKEN` or from the token file in Hronaut's profile and sends it with the connection, so the token is never written to your settings. Hronaut accepts the connection without a token while its MCP authentication is off.

- Changed Hronaut's MCP port? Set **Hronaut: Mcp Port** (`hronaut.mcpPort`) in your user settings to the same port, or start the editor with `HRONAUT_MCP_PORT` set as you do for Hronaut.
- Hronaut uses another profile folder? Start the editor with `HRONAUT_USER_DATA_DIR` set as you do for Hronaut.
- Added Hronaut to `mcp.json` before? Remove that entry, so the agent does not get Hronaut's tools twice.

Hronaut runs on your computer, so a cloud-hosted agent cannot reach it. See the [setup guide](https://hronaut.dev/setup) and the [privacy policy](https://hronaut.dev/privacy).

## License

Hronaut and this extension are source-available under the [Subscription and Trial License](LICENSE.md). The 10-day trial starts with the first agent tool call, with no credit card required. Ongoing use requires a subscription afterward: $4/month or $24/year per named user (50% off $48).
