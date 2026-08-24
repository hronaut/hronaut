# Hronaut

Hronaut is a visible, persistent Electron browser that exposes its live tabs to AI clients through MCP. It keeps the browser open independently of any individual AI session, so humans and agents can share the same local browsing context.

[Website](https://hronaut.dev) · [Downloads](https://github.com/hronaut/hronaut/releases/latest) · [Issues](https://github.com/hronaut/hronaut/issues) · [Detailed reference](REFERENCE.md)

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

Hronaut Home contains current setup instructions for Codex, Claude Code, Cursor, VS Code/GitHub Copilot, and generic MCP clients.

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
