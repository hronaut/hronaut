# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Changed

- Move global shell keyboard, modal priority, and Escape-surface routing out of `App.vue` into a focused controller.
- Move saved-password fill and account-picker orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep command palettes, dialogs, and tool panels open when Escape belongs to an active IME composition.
- Cancel a pending credential fill when the user changes tabs or its page navigates or reloads, including same-origin pages, instead of filling a stale background document.
- Keep IME candidate navigation and confirmation inside address, command, tab-search, and credential inputs instead of moving, running, filling, or closing shell results.

## [1.4.4] - 2026-08-25

### Changed

- Split active-tab context transitions and detached-panel refresh coordination out of `App.vue` into focused controllers.
- Move shell overlay exclusivity, relayout, and native address-overlay coordination out of `App.vue` into a focused controller.

### Fixed

- Close crowded tabs with the familiar middle-click gesture without activating the page or bypassing the global interaction lock.
- Reset docked diagnostic panels when the current page reloads at the same URL so stale Network and Console evidence is not left visible.
- Keep an active tab visible when its workspace changes, and recompute crowded-tab overflow after tabs move into collapsed workspaces.
- Keep the active tab visible when a crowded tab strip becomes narrower after a window or toolbar resize.
- Close every competing docked tool panel when Site Controls, Site Storage, Bookmarks, or another shell overlay opens.
- Ignore stale detached-panel refresh failures after a newer tab context or window teardown.

## [1.4.3] - 2026-08-25

### Added

- Add workspace-aware Left/Right/Home/End keyboard navigation across visible tabs, with manual Enter/Space activation so browsing tab labels does not wake or switch pages.

### Changed

- Split address-focus and new-tab shell orchestration out of `App.vue` into focused navigation controllers.
- Split Site Storage shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Prevent delayed shortcut or workspace tab creation from stealing address focus after a newer tab selection.
- Reject cross-workspace tab drag targets before showing a drop indicator or attempting an invalid reorder.
- Suppress obsolete Site Storage refresh failures after the panel closes or resets for a newer tab.

## [1.4.2] - 2026-08-25

### Fixed

- Keep crowded tab strips navigable with visible overflow controls, horizontal mouse-wheel scrolling, and automatic active-tab reveal.

## [1.4.1] - 2026-08-25

### Fixed

- Make `browser_press` dispatch modifier combinations and printable characters correctly instead of sending chord text as an invalid literal key.

## [1.4.0] - 2026-08-24

### Added

- Let `browser_wait` accept up to 20 candidate texts and resolve with the first visible match for workflows with multiple possible outcomes.
- Let `browser_click` dispatch Chromium's native double-click sequence for controls that require two clicks or a `dblclick` event.

### Changed

- Split Find-in-page shell orchestration out of `App.vue` into a focused controller.
- Split Tab Search shell orchestration out of `App.vue` into a focused controller.
- Split Zoom shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close the Split View menu and other competing surfaces when Find-in-page opens instead of stacking controls over the page.
- Close the Split View menu and other competing surfaces when Tab Search opens instead of stacking side panels over the page.
- Close the Split View menu and other competing surfaces when Zoom opens instead of stacking controls over the page.
- Fail `textGone` waits when the renderer cannot verify page text before the deadline instead of reporting unobserved absence as success.
- Reject `browser_click` prompt text unless the same call explicitly accepts the prompt, preventing an accidental blocking native dialog.

## [1.3.0] - 2026-08-24

### Added

- Add `textGone` to `browser_wait` for bounded waits until rendered page text disappears.

### Changed

- Split shared transient-panel closing policy out of `App.vue` into a focused controller.
- Split Split View menu shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Close Find-in-page immediately when Page Tools or another transient panel opens, while completing browser-side Find cleanup in the background.
- Close Find-in-page when the Split View menu opens instead of stacking both controls over the page.

## [1.2.2] - 2026-08-24

### Changed

- Split Privacy Settings shell orchestration out of `App.vue` into a focused controller.
- Start Home, address-focus, and Zoom actions before awaiting Find-in-page cleanup through a shared transition controller.
- Retain the first failed Playwright Electron trace in CI without enabling retries, extract diagnostics from the disposable Docker container, and upload them for seven days.

### Fixed

- Open Privacy Settings immediately while Find-in-page cleanup finishes, and keep a newer close, section change, or Privacy request authoritative over delayed cleanup results.
- Prevent delayed Find-in-page cleanup from opening Home after a newer tab selection.

## [1.2.1] - 2026-08-24

### Added

- Add verified OpenCode MCP setup to Hronaut Home, the README, and the public setup guide, including global/project paths and connection diagnostics.

### Changed

- Split browser-collection panel orchestration out of `App.vue` into a focused controller.
- Split Site Controls shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep the newest Downloads, Bookmarks, and History request authoritative, and prevent a late Downloads refresh from reopening or displacing a newer panel choice.
- Prevent a delayed Find-in-page cleanup from opening Site Controls underneath a newer Settings surface.
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
