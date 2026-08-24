# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Added

- Add verified OpenCode MCP setup to Hronaut Home, the README, and the public setup guide, including global/project paths and connection diagnostics.

### Fixed

- Generate authenticated OpenCode headers with its token-file substitution instead of asking people to paste the owner token into JSON.
- Show the Hronaut “H” mark on Home instead of the stale pre-rename “B”.
- Document the canonical Cloudflare Pages storefront repository instead of a nonexistent GitHub Pages workflow in the desktop repository.

## [1.2.0] - 2026-08-24

### Added

- Add `browser_generate_locator`, which turns a snapshot ref or CSS selector into a unique Playwright locator while excluding form values and page source.
- Cover semantic, test-ID, CSS-fallback, escaping, and privacy edge cases with unit and real-Electron Docker regression tests.

### Changed

- Split command-palette shell orchestration and exhaustive command dispatch out of `App.vue` into a focused controller.
- Update the Home and public website catalog to advertise all 65 MCP tools and the locator-generation workflow.

## [1.1.1] - 2026-08-24

### Fixed

- Open **Buy commercial license** in the operating system's default browser instead of creating a Hronaut tab.

## [1.1.0] - 2026-08-24

### Added

- Add `browser_find`, a bounded literal search over Hronaut's sanitized semantic page snapshot that returns compact matching snippets and refs.
- Cover extracted browser-shell components, compact snapshot search, release workflow contracts, and the new MCP capability with unit and real-Electron regression tests.

### Changed

- Split the address and site-controls row, recoverable page-problem bar, and detached-panel empty state out of the renderer root component.
- Require lint, unit tests, production builds, dependency audits, and the Docker Electron suite before release package builds can start.

### Fixed

- Keep the Home dashboard and public website MCP tool counts derived from or tested against the live server catalog.
- Preserve source offsets for case-insensitive snapshot matches whose Unicode case folding changes string length.

## [1.0.0] - 2026-08-24

### Added

- Launch Hronaut 1.0.0: a visible, persistent local browser and QA workspace controlled through MCP.
- Publish Hronaut under the PolyForm Noncommercial License 1.0.0 with a separate paid commercial subscription license.

### Changed

- Establish the Hronaut release, update, package, executable, URL-scheme, profile, and environment-variable identities.
- Move the canonical source and release feed to `github.com/hronaut/hronaut`.
