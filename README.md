# Hronaut

Hronaut is a visible, persistent Electron browser that exposes durable agent workspaces through MCP. It keeps the browser open independently of any individual AI session, so people can watch, pause, and take over while agents work in separate local browser profiles.

[![skills.sh](https://skills.sh/b/hronaut/hronaut)](https://skills.sh/hronaut/hronaut)

[Website](https://hronaut.dev) · [Setup](https://hronaut.dev/setup) · [Browser MCP decision guide](https://hronaut.dev/browser-mcp-guide) · [Downloads](https://github.com/hronaut/hronaut/releases/latest) · [Issues](https://github.com/hronaut/hronaut/issues) · [Detailed reference](REFERENCE.md)

## See Hronaut in action

[![Hronaut — the browser your coding agent can come back to](https://hronaut.dev/hronaut-social-card.png)](https://hronaut.dev/#demo)

Watch the [35-second product overview](https://hronaut.dev/#demo), then download Hronaut for Windows, macOS, or Linux.

Not sure which browser model fits your workflow? Read the source-backed [Browser MCP decision guide](https://hronaut.dev/browser-mcp-guide), which compares Hronaut with Playwright MCP, Chrome DevTools MCP, and an extension-based Browser MCP without claiming persistence is unique.

### Works with your coding agent

Connect through Hronaut's local Streamable HTTP MCP endpoint. Choose the focused guide for your client, or start with the [generic setup](https://hronaut.dev/setup):

- **Terminal and desktop agents:** [Codex](https://hronaut.dev/codex-browser-mcp), [Claude Code](https://hronaut.dev/claude-code-browser-mcp), [Gemini CLI](https://hronaut.dev/gemini-cli-browser-mcp), [OpenCode](https://hronaut.dev/opencode-browser-mcp), [Devin Local](https://hronaut.dev/devin-local-browser-mcp), [Mistral Vibe](https://hronaut.dev/mistral-vibe-browser-mcp), and [Warp](https://hronaut.dev/warp-browser-mcp).
- **Editor agents:** [Cursor](https://hronaut.dev/cursor-browser-mcp), [VS Code / GitHub Copilot](https://hronaut.dev/github-copilot-browser-mcp), [Cline](https://hronaut.dev/cline-browser-mcp), [Kiro](https://hronaut.dev/kiro-browser-mcp), [Kilo Code](https://hronaut.dev/kilo-code-browser-mcp), [JetBrains Junie](https://hronaut.dev/jetbrains-junie-browser-mcp), and [Zed](https://hronaut.dev/zed-browser-mcp).
- **Other clients:** use the [generic Streamable HTTP setup](https://hronaut.dev/setup).

## When Hronaut is the right browser

Hronaut fits when you already have a coding agent and want the browser to remain local, visible, and reusable after one task or chat ends.

- Keep authenticated sites in named, isolated workspaces instead of rebuilding login state for every agent session.
- Watch work as it happens, pause agent access, lock website interaction, or take over the same tab for CAPTCHA, 2FA, payment, and other human-only steps.
- Reuse one deliberately scoped browser workspace from compatible local MCP clients without connecting the agent to your everyday browser profile.
- Preserve tabs and evidence between coding sessions for debugging, authenticated QA, and multi-agent handoffs.

Use a task-owned headless browser or automation library when the browser should be disposable or embedded inside your own agent runtime. Use a hosted browser service when you need remote regions, managed proxies, stealth, or fleet-scale execution. The [decision guide](https://hronaut.dev/browser-mcp-guide) covers the tradeoffs in more detail.

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

The public [setup guide](https://hronaut.dev/setup) provides tested commands for Codex, Claude Code, Gemini CLI, Cursor, Cline, Kilo Code, JetBrains Junie, Devin Local, Zed, Mistral Vibe, Warp, VS Code/GitHub Copilot, OpenCode, and generic MCP clients. Hronaut Home contains the current profile-specific version for every built-in client, including the right endpoint and authentication settings.

Compatible clients also receive concise server instructions during MCP initialization: create a fresh isolated workspace first, prefer semantic snapshots and refs, and request human attention only for a genuinely manual step. These instructions improve tool selection but do not replace Hronaut's enforced workspace and interaction boundaries.

### Install the Hronaut Agent Skill

Skill-aware coding agents can install Hronaut's portable workflow guidance directly from this repository:

```bash
npx skills add hronaut/hronaut --skill hronaut
```

The skill teaches the agent to create its own isolated workspace, prefer semantic page interactions, preserve the user's Default workspace, and request a safe human handoff for CAPTCHA, 2FA, or credential entry. It does not configure the MCP connection or contain an authentication token; start Hronaut and copy the current client setup from Hronaut Home first.

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

### Cline

Hronaut Home generates Cline's explicit `streamableHttp` server definition with approval left on and authentication-aware headers. Add it through Cline's MCP Servers panel or CLI manager, then run `cline config mcp --json` to verify the enabled server. The public [Cline browser MCP guide](https://hronaut.dev/cline-browser-mcp) explains when to use Cline's built-in task-scoped browser and when a separately owned persistent Hronaut workspace is useful. See Cline's [official MCP guide](https://github.com/cline/cline/blob/main/docs/mcp/mcp-overview.mdx) for the current configuration schema.

### Kilo Code

Hronaut Home generates Kilo Code's global `~/.config/kilo/kilo.jsonc` remote MCP entry with an owner-token file reference when authentication is enabled. Run `kilo mcp list` to verify the local connection. Use Kilo's built-in browser for disposable task-owned automation; use Hronaut when a visible named workspace must survive the task and remain available to Kilo CLI, the IDE, or another local client. Current Kilo Cloud Agents cannot reach Hronaut's loopback endpoint. See the [focused Kilo Code browser MCP guide](https://hronaut.dev/kilo-code-browser-mcp) and Kilo's [official MCP guide](https://kilo.ai/docs/automate/mcp/using-in-kilo-code).

### JetBrains Junie

Hronaut Home generates Junie's user-level `~/.junie/mcp/mcp.json` remote MCP entry for the current local endpoint. The same configuration is shared by Junie CLI and Junie in JetBrains IDEs. Open Junie's `/mcp` screen to verify that Hronaut is active. When authentication is enabled, Hronaut uses a copy-safe token placeholder rather than displaying the owner token; paste the token locally and do not commit it in a project-scoped `.junie/mcp/mcp.json`. See the [focused JetBrains Junie browser MCP guide](https://hronaut.dev/jetbrains-junie-browser-mcp) and Junie's [official MCP configuration guide](https://junie.jetbrains.com/docs/junie-cli-mcp-configuration.html).

### Devin Local

Hronaut Home generates Devin Local's user-level `~/.config/devin/mcp_config.json` entry on macOS and Linux or `%APPDATA%\devin\mcp_config.json` on Windows. It uses the current HTTP transport and, when authentication is enabled, references Hronaut's owner-token file without embedding the token in JSON. Run `devin mcp list` and `devin mcp get hronaut` to verify the saved server. This local setup also serves the default agent in new Devin Desktop tabs; Cloud Devin cannot reach Hronaut's loopback endpoint. See the [focused Devin Local browser MCP guide](https://hronaut.dev/devin-local-browser-mcp) and Devin's [official MCP configuration guide](https://docs.devin.ai/cli/extensibility/mcp/configuration).

### Zed

Hronaut Home generates Zed's user-level `context_servers` entry for the current loopback endpoint. For an unprotected Hronaut profile it includes a non-secret local marker header, preventing Zed from starting an OAuth flow that Hronaut does not implement; protected profiles receive a copy-safe owner-token placeholder instead. Verify the live server through **Settings → AI → MCP Servers** and confirm its green **Server is active** status. Zed Agent uses the server directly and can forward it to external ACP agents, while terminal threads use their CLI's own MCP configuration. See the [focused Zed browser MCP guide](https://hronaut.dev/zed-browser-mcp) and Zed's [official MCP documentation](https://zed.dev/docs/ai/mcp).

The server listens only on loopback. Authentication is optional for a new profile and can be enabled under **Settings → MCP security**.

## Development checks

```bash
npm run lint
npm test
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

## Local Web3 wallets

Hronaut can hold separate local EVM, Solana, and Tron accounts, attach them to selected workspaces, and mediate website or coding-agent requests through simulation, policy checks, and trusted Hronaut approval. Private keys and recovery phrases are not returned to website pages or MCP clients. Mainnet signing always requires explicit human approval; bounded automation is limited to configured local networks and testnets.

See [docs/WALLETS.md](docs/WALLETS.md) for the threat model, supported methods, Linux vault behavior, recovery, RPC configuration, revocation, and the exact security boundary. Hronaut does not use WalletConnect, Reown, hosted custody, or proprietary wallet SDKs.
