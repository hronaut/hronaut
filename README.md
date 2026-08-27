# Hronaut

Hronaut is a visible, persistent Electron browser that exposes durable agent workspaces through MCP. It keeps the browser open independently of any individual AI session, so people can watch, pause, and take over while agents work in separate local browser profiles.

[Website](https://hronaut.dev) · [Setup guide](https://hronaut.dev/setup) · [OpenCode guide](https://hronaut.dev/opencode-browser-mcp) · [Browser MCP guide](https://hronaut.dev/browser-mcp-guide) · [Downloads](https://github.com/hronaut/hronaut/releases/latest) · [Issues](https://github.com/hronaut/hronaut/issues) · [Detailed reference](REFERENCE.md)

## See Hronaut in action

[![Hronaut — the browser your coding agent can come back to](https://hronaut.dev/hronaut-social-card.png)](https://hronaut.dev/#demo)

Watch the [35-second product overview](https://hronaut.dev/#demo), then download Hronaut for Windows, macOS, or Linux.

Not sure which browser model fits your workflow? Read the source-backed [Browser MCP decision guide](https://hronaut.dev/browser-mcp-guide), which compares Hronaut with Playwright MCP, Chrome DevTools MCP, and an extension-based Browser MCP without claiming persistence is unique.

## Highlights

- Persistent tabs, cookies, storage, sessions, workspaces, split views, and window state.
- Crowded-session tab search, unmistakable active-tab treatment, and top or collapsible left-side tab layouts.
- Nine appearance choices: System, Light, Dark, Midnight, Sepia, Cyberpunk, Matrix, Machine, and Galactic.
- Local Streamable HTTP MCP endpoint with browser navigation, interaction, inspection, diagnostics, downloads, storage, and accessibility tools.
- Multi-agent workspaces with stable UUIDv7 identities and isolated browser profiles.
- Human-interaction locks, instant MCP pause, explicit permissions, and optional bearer-token authentication.
- Built-in history, bookmarks, downloads, password vault, site controls, responsive preview, visual comparison, and Chromium diagnostics.
- Automatic update checks against public GitHub releases; downloads and installation always require user action.
- English, Ukrainian, Russian, German, French, Spanish, and Polish interface languages.

## Install

Download the latest package for Windows, macOS, or Linux from [GitHub Releases](https://github.com/hronaut/hronaut/releases/latest).

On Windows x64, install the verified portable build and Start Menu shortcut with Scoop:

```powershell
scoop install https://raw.githubusercontent.com/hronaut/hronaut/main/packaging/scoop/hronaut.json
```

The Windows binary remains unsigned, and the macOS packages are not Apple-notarized, so Windows SmartScreen or macOS Gatekeeper may show a warning. Verify downloads with the published `hashes.txt` file and GitHub artifact attestations.

## Run from source

Requirements: Node.js 22 or newer and a graphical Linux, macOS, or Windows session.

```bash
npm install
npm run dev
```

Build and run the desktop application:

```bash
npm run build
npm start
```

Development uses a separate persistent `hronaut-dev` profile. Installed builds use the normal Hronaut profile.

## Connect an MCP client

Start Hronaut, then configure a Streamable HTTP client with the local endpoint:

```json
{
  "mcpServers": {
    "hronaut": {
      "url": "http://127.0.0.1:47812/mcp"
    }
  }
}
```

The public [setup guide](https://hronaut.dev/setup) provides tested commands for Codex, Claude Code, Gemini CLI, Cursor, VS Code/GitHub Copilot, OpenCode, and generic MCP clients. Hronaut Home contains the current profile-specific version for every client, including the right endpoint and authentication settings.

Compatible clients also receive concise server instructions during MCP initialization: create a fresh isolated workspace first, prefer semantic snapshots and refs, and request human attention only for a genuinely manual step. These instructions improve tool selection but do not replace Hronaut's enforced workspace and interaction boundaries.

After trying it, share a short [setup report](https://github.com/hronaut/hronaut/issues/new?template=setup-feedback.yml)—successful connections are useful too. The structured form asks for the client, operating system, Hronaut version, and outcome. Never include credentials, MCP tokens, private page data, or personal browser-session information in a public issue.

### First successful run

After your client reports Hronaut as connected, paste this into the coding agent:

```text
Using Hronaut, create a new isolated workspace named “Hronaut first run”, open https://example.com, take a semantic snapshot, and tell me the page heading. Do not use the Default workspace.
```

Hronaut Home provides the same prompt with a copy button. A successful run visibly creates a separate workspace, opens the page, and records content-free tool activity on Home; the workspace and its browser profile remain available after the coding-agent conversation ends.

### OpenCode

For a new Hronaut profile with MCP authentication disabled, add this server to the global `~/.config/opencode/opencode.json` or a project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hronaut": {
      "type": "remote",
      "url": "http://127.0.0.1:47812/mcp",
      "enabled": true,
      "oauth": false
    }
  }
}
```

Start Hronaut, then verify the connection with `opencode mcp list`. If MCP authentication is enabled, copy the OpenCode configuration from Hronaut Home; it references the owner-only token file without placing the token in the JSON. Use `opencode mcp debug hronaut` to diagnose connection or authentication failures. Hronaut's [focused OpenCode browser MCP guide](https://hronaut.dev/opencode-browser-mcp) includes stable and V2 configuration, verification, security boundaries, and browser-ownership tradeoffs. See OpenCode's [official MCP guide](https://opencode.ai/docs/mcp-servers/) for the current stable schema.

### Gemini CLI

Hronaut Home generates the current user-level `~/.gemini/settings.json` entry with Gemini CLI's documented `httpUrl` field and authentication-aware headers. After saving it, run `gemini mcp list` to verify that Hronaut is connected. The public [Gemini CLI browser MCP guide](https://hronaut.dev/gemini-cli-browser-mcp) covers setup, observable verification, browser-lifecycle tradeoffs, and security boundaries. See Gemini CLI's [official v0.57.0 MCP server guide](https://github.com/google-gemini/gemini-cli/blob/v0.57.0/docs/tools/mcp-server.md#L152-L174) for the verified configuration schema.

The server listens only on loopback. Authentication is optional for a new profile and can be enabled under **Settings → MCP security**.

## Development checks

```bash
npm run lint
npm test
npm run typecheck
npm run build
npm run test:integration:headless
```

Release packaging and publishing are centralized in [`.github/workflows/release.yml`](.github/workflows/release.yml). Every local package command uses `--publish never`.

## License

Hronaut is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE). Uses not permitted by that license require an active [commercial subscription license](COMMERCIAL-LICENSE.md).

Outside contributions are welcome under the terms in [CONTRIBUTING.md](CONTRIBUTING.md). Security reports should follow [SECURITY.md](SECURITY.md).

For billing and licensing support, contact [support@hronaut.dev](mailto:support@hronaut.dev).

## Documentation

The [detailed reference](REFERENCE.md) covers browser behavior, privacy and security boundaries, every MCP tool group, testing, packaging, and release operations.
