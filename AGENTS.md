# Hronaut contributor instructions

Hronaut is a visible, persistent Electron browser controlled through a local
Streamable HTTP MCP server. Keep the browser useful to both its human operator
and connected coding agents. Read `README.md` for the product overview and
`REFERENCE.md` for detailed behavior and operational contracts.

## Runtime boundaries

- `src/main/` owns Electron, browser contents, persistence, native dialogs,
  operating-system integration, licensing, updates, and the MCP server.
- `src/preload/` exposes the narrow typed bridge used by trusted renderer code.
- `src/renderer/` owns Vue UI state. Renderer stores mirror main-process state;
  they do not become the authority for browser or operating-system behavior.
- `src/shared/` contains contracts and utilities shared across processes.
- `tests/*.test.ts` contains Vitest unit and component tests.
- `tests/integration/*.e2e.ts` exercises the real Electron application through
  Playwright with an isolated temporary profile.

Do not expose Node or Electron primitives directly to rendered web content.
Keep privileged actions in the main process and expose only the smallest
required preload API. Preserve workspace isolation and reject cross-workspace
tab access.

## Making changes

- Use TypeScript and follow the existing ESM import style.
- Reuse existing components, composables, stores, and shared contracts before
  introducing parallel abstractions.
- Keep `src/renderer/src/App.vue` focused on composition. Move cohesive state
  transitions or reusable UI into a focused composable or component, with a
  targeted test.
- Treat asynchronous panel and dialog actions as races: a late completion must
  not reopen, close, or overwrite a newer user action.
- Preserve the Hronaut name in UI, package, profile, protocol, release, and MCP
  identities. Do not reintroduce the former Bronom name.
- Keep public text privacy-safe. Diagnostic output must remain bounded and must
  not expose credentials, form values, complete page source, or private browser
  data unless an existing explicit opt-in contract permits it.

## Verification

Install with Node.js 22 or newer:

```bash
npm ci
```

Run focused tests while iterating, then run the relevant gates:

```bash
npm run lint
npm test
npm run typecheck
npm run build
```

Every bug fix needs a regression test that fails for the original behavior.
Prefer stable semantic roles, test IDs, and observable UI or process state over
timing-only assertions. Clean up every Electron listener, IPC handler, window,
server, and temporary profile created by a test.

The authoritative clean-environment Electron gate is:

```bash
npm run test:integration:docker
```

It builds and runs both the Playwright Electron suite and native-dialog checks
inside the pinned Docker/Xvfb image. Run it for changes to the main/preload
boundary, browser lifecycle, persistence, MCP, native integration, or before a
release. Do not replace this gate with a mocked renderer-only check.

## Releases and adjacent repositories

Document user-visible changes under `CHANGELOG.md`'s Unreleased section. The
release workflow builds from an immutable `v<package version>` tag and publishes
only after validation and platform packaging succeed; do not hand-publish local
artifacts.

The deployed commercial website is maintained separately in the sibling
`../hronaut-page` repository. Changes there have independent tests, history,
Cloudflare configuration, and deployment approval. Do not edit or deploy it as
an incidental part of a desktop-app change.
