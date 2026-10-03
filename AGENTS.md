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

Routine improvement commits may be reviewed, committed, pushed, and merged
without executing test suites. Add relevant regression coverage, but explicitly
record it as untested until executed. Do not wait on test runs during routine
improvement cycles. Respect any required reviews, branch protections, and
remaining checks; CodeQL continues independently.

Full validation is required at release time. Use the existing version-bump →
auto-tag → release pipeline: the immutable release tag runs static validation,
all unit/component tests, the full Docker/Electron and native-dialog gate, and
platform packaging before publication. A failed release gate blocks publication;
fix it without overwriting a published tag. The CI workflow is manual-only for
explicit investigations or release rehearsals, with packaging on `release/`
branches. Never describe unexecuted checks as passing.

Install with Node.js 22 or newer:

```bash
npm ci
```

For release validation or an explicitly requested investigation, run the relevant gates:

```bash
npm run lint
npm test
npm run build
```

For fast static feedback on a focused change, pass its files to `lint:focused`
and run only the owning TypeScript project before the full gates:

```bash
npm run validate:focused -- src/main/wallet/broker.ts tests/wallet-broker.test.ts
npm run typecheck:incremental
```

`validate:focused` runs content-cached ESLint and only the affected incremental
TypeScript project or projects concurrently. Use the separate `lint:focused`
and `typecheck:*` scripts when diagnosing one gate in isolation.
The full incremental typecheck runs two independent project graphs concurrently
by default; set `HRONAUT_TYPECHECK_JOBS=1` on a constrained machine or up to `3`
when measuring a dedicated typecheck run. Hosted CI deliberately uses one job
because Vitest, lint, and the application build already share that runner.

Every bug fix needs regression coverage for the original failure. During routine
cycles, describe the expected failure and defer executing the test to release validation.
Prefer stable semantic roles, test IDs, and observable UI or process state over
timing-only assertions. Clean up every Electron listener, IPC handler, window,
server, and temporary profile created by a test.

The authoritative clean-environment Electron gate is:

```bash
npm run test:integration:docker
```

Keep both Playwright image pins in `Dockerfile.test` aligned with the resolved
`playwright` version in `package-lock.json` when upgrading the test driver.
`tests/docker-playwright-version.test.ts` checks this: a mismatched image can
pass Electron-only tests while standalone browser launches cannot find a binary.

It builds and runs both the Playwright Electron suite and native-dialog checks
inside the pinned Docker/Xvfb image. The single test service uses Docker's
existing bridge network: Electron, MCP, and fixture servers communicate through
container-local loopback. New project names and dependency cache keys therefore
do not allocate extra subnets. Do not add service-name DNS dependencies or host
port mappings without revisiting this setup and its networking regression tests.

Its dependency stage normalizes only the
root application version, so release-only version bumps can reuse installed
dependencies. Dependency contents and install constraints still invalidate that
cache; the final integration stage copies the original checkout and version.
Local runs use four workers with separate Xvfb displays
and one shared test queue after one application build, so a worker that finishes
a short test can take the next pending case. Hosted CI gives each of eight shards
an isolated runner with one worker to limit native focus and capture contention. Use
`HRONAUT_INTEGRATION_SHARD_WORKERS` to tune a selected hosted shard. The existing
`HRONAUT_INTEGRATION_SHARDS` setting controls the local worker count. Set
`HRONAUT_INTEGRATION_SHARDS=1` when diagnosing order or resource-sensitive behavior.
Run it before publishing a release, including changes to the main/preload
boundary, browser lifecycle, persistence, MCP, or native integration accumulated
since the previous release. Do not replace this gate with a mocked renderer-only check.
For fast regression-first unit or component feedback, pass the affected Vitest
files and options through the focused Docker runner:

```bash
npm run test:unit:docker:focused -- tests/home-page.test.ts
npm run test:unit:docker:focused -- tests/home-page.test.ts -t "renders the VS Code action"
```

For one Playwright file or one named integration case, use the same pinned image
without running the entire suite:

```bash
npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts --grep "test title"
```

For release visual-baseline repairs, generate screenshots in the pinned Docker
image, for example with `npm run test:integration:docker:focused --
tests/integration/ui-primitives-visual.e2e.ts --update-snapshots`. Inspect the new
images before committing them. Host-native screenshots can use different fonts
and must not replace Linux CI baselines. Keep visual comparison tolerances intact.

Arguments after `--` are passed directly to Vitest or Playwright respectively.
The Docker dependency layer and focused `node_modules` volume are keyed to the
lockfile and dependency-image definition, so repeat runs reuse them safely. Use
`npm run test:docker:cache:prune` to remove old focused dependency volumes.
Focused Electron runs reuse a content-verified application build when both its
inputs and `out/` are unchanged, and compile again after any input or output
change. They do not repeat the separate type-analysis gate. A focused Docker
pass is not a substitute for
`npm run test:integration:docker` before release publication.

When a change spans many Electron cases, run the complete live-checkout suite
through the same warm dependency volume without repeating type analysis:

```bash
npm run test:integration:docker:fast
```

This fast full-suite preflight includes native-dialog coverage and supports
`HRONAUT_INTEGRATION_SHARDS=1` through `8`, but its bind-mounted source is not
the immutable-image proof supplied by the authoritative Docker gate.

## Releases and adjacent repositories

Document user-visible changes under `CHANGELOG.md`'s Unreleased section. The
release workflow builds from an immutable `v<package version>` tag and publishes
only after validation and platform packaging succeed; do not hand-publish local
artifacts.

The deployed commercial website is maintained separately in the sibling
`../hronaut-page` repository. Changes there have independent tests, history,
Cloudflare configuration, and deployment approval. Do not edit or deploy it as
an incidental part of a desktop-app change.
