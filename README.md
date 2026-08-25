# Hronaut

Hronaut is a visible, persistent Electron browser that exposes durable agent workspaces through MCP. It keeps the browser open independently of any individual AI session, so people can watch, pause, and take over while agents work in separate local browser profiles.

[Website](https://hronaut.dev) · [Setup guide](https://hronaut.dev/setup) · [OpenCode guide](https://hronaut.dev/opencode-browser-mcp) · [Browser MCP guide](https://hronaut.dev/browser-mcp-guide) · [Downloads](https://github.com/hronaut/hronaut/releases/latest) · [Issues](https://github.com/hronaut/hronaut/issues) · [Detailed reference](REFERENCE.md)

## See Hronaut in action

[![Hronaut — the browser your coding agent can come back to](https://hronaut.dev/hronaut-social-card.png)](https://hronaut.dev/#demo)

Watch the [35-second product overview](https://hronaut.dev/#demo), then download Hronaut for Windows, macOS, or Linux.

Not sure which browser model fits your workflow? Read the source-backed [Browser MCP decision guide](https://hronaut.dev/browser-mcp-guide), which compares Hronaut with Playwright MCP, Chrome DevTools MCP, and an extension-based Browser MCP without claiming persistence is unique.

## Highlights

- Persistent tabs, cookies, storage, sessions, workspaces, split views, and window state.
- Local Streamable HTTP MCP endpoint with browser navigation, interaction, inspection, diagnostics, downloads, storage, and accessibility tools.
- Multi-agent workspaces with stable UUIDv7 identities and isolated browser profiles.
- Human-interaction locks, instant MCP pause, explicit permissions, and optional bearer-token authentication.
- Built-in history, bookmarks, downloads, password vault, site controls, responsive preview, visual comparison, and Chromium diagnostics.
- Automatic update checks against public GitHub releases; downloads and installation always require user action.
- English, Ukrainian, Russian, German, French, Spanish, and Polish interface languages.

## Install

Download the latest package for Windows, macOS, or Linux from [GitHub Releases](https://github.com/hronaut/hronaut/releases/latest).

The initial release artifacts are not platform code-signed or Apple-notarized, so Windows SmartScreen or macOS Gatekeeper may show a warning. Verify downloads with the published `hashes.txt` file and GitHub artifact attestations.

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

The public [setup guide](https://hronaut.dev/setup) provides tested commands for Codex, Claude Code, Cursor, VS Code/GitHub Copilot, OpenCode, and generic MCP clients. Hronaut Home contains the current profile-specific version, including the right endpoint and authentication settings.

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
