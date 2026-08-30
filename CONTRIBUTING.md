# Contributing to Hronaut

Thank you for helping improve Hronaut. Bug reports, focused design proposals, documentation suggestions, accessibility feedback, and private security reports are welcome.

## Code contributions are temporarily paused

Hronaut uses PolyForm Noncommercial and separate commercial licensing. Hronaut must therefore have sufficient rights to distribute accepted contributions under both models.

Do not open a code pull request until this repository publishes a contributor agreement and reopens code contributions. A Developer Certificate of Origin sign-off alone does not provide the relicensing rights required by this model. Unsolicited patches cannot be accepted or incorporated.

You may still:

- open a focused issue for a reproducible defect or proposal;
- suggest documentation changes in an issue;
- report vulnerabilities privately through [.github/SECURITY.md](.github/SECURITY.md).

Do not submit code, media, fonts, credentials, private website data, or other third-party material in an issue.

## Development

Hronaut requires Node.js 22 or newer.

```bash
npm ci
npm run validate
npm run build:website
```

The isolated Docker/Xvfb integration suite is available for browser, Electron lifecycle, MCP, clipboard, and native-dialog validation:

```bash
npm run test:integration:docker
```

During regression-first development, run a single Electron Playwright file or
named case in the same pinned Docker/Xvfb environment:

```bash
npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts --grep "test title"
```

For a fast unit/component feedback loop in that same Docker dependency image,
target one Vitest file or case without building or launching Electron:

```bash
npm run test:unit:docker:focused -- tests/renderer/modal-dialog-focus.test.ts
npm run test:unit:docker:focused -- tests/renderer/modal-dialog-focus.test.ts -t "wraps keyboard focus"
```

You can also target a source line, list matching tests without launching
Electron, or stop after the first failure:

```bash
npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts:120
npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts --list
npm run test:integration:docker:focused -- tests/integration/browser-shell.e2e.ts --max-failures=1
```

Arguments after `--` are passed directly to Vitest or Playwright. Both focused
runners reuse a dependency-only Docker layer and a persistent `node_modules`
volume keyed by the lockfile and dependency-image definition, then bind-mount
the current checkout.
Source and test edits therefore take effect immediately without rebuilding the
full source image, while dependency changes still trigger `npm ci` in Docker.
Old focused dependency volumes can be removed explicitly with
`npm run test:docker:cache:prune`.

For a wider preflight, run the complete Electron and native-dialog suite against
the live checkout through that warm dependency volume. This skips type analysis
that `npm run validate` already performs:

```bash
npm run test:integration:docker:fast
```

Always run the complete `test:integration:docker` gate before submitting or
delivering the change; unlike the fast preflight, it proves an immutable source
image.

The complete Docker gate distributes individual test cases across six isolated
Electron shards by default, so a large test file cannot dominate one shard. On
a memory-constrained machine, reduce concurrency without changing the suite:

```bash
HRONAUT_INTEGRATION_SHARDS=2 npm run test:integration:docker
```

Hosted and release CI use two shards by default to avoid CPU-contention timeouts
on constrained runners; hosted CI assigns those shards to separate runners,
while an explicit `HRONAUT_INTEGRATION_SHARDS` still wins for single-container runs.
The hosted integration job skips duplicate type analysis because its parallel
validation job runs the complete TypeScript graph. The standalone Docker command
still performs the full typecheck before building and testing. Hosted jobs use
Docker's native image path because loading the large Playwright image through a
remote BuildKit cache was slower in measured CI runs than rebuilding its
lock-keyed dependency layer on the hosted runner.

Static validation runs lint, unit/component tests, incremental typechecking,
and the application build concurrently. Set `HRONAUT_VITEST_WORKERS` when a CI
runner needs a different unit-test concurrency limit. A dedicated incremental
typecheck runs two project graphs concurrently by default; use
`HRONAUT_TYPECHECK_JOBS=1` on constrained runners or up to `3` when benchmarking
typecheck in isolation. Hosted validation keeps it at one because the other
static gates already consume the runner's available CPU.

For focused static feedback, run content-cached ESLint and only the TypeScript
projects that own the edited files:

```bash
npm run validate:focused -- src/main/home-page.ts tests/home-page.test.ts
```
