# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Added

### Changed

### Fixed

## [1.6.1] - 2026-08-26

### Added

### Changed

- Move browser navigation, address, find, zoom, and bookmark controls out of `App.vue` into a focused component.
- Move website interaction-lock, split-view, capture, picker, and page-tools controls out of `App.vue` into a focused component.
- Move docked-panel resize presentation and input events out of `App.vue` into a focused accessible component.

### Fixed

- Retry transient renderer service startup failures without requiring an application restart, while keeping retries bounded and reporting recovery.
- Apply rapid repeated mute and interaction-lock toggles in order against the latest browser state instead of losing the second user action to a stale renderer snapshot.
- Prevent an element picker from starting while a viewport or full-page screenshot is still capturing and writing to the clipboard.
- Keep the latest Settings change authoritative when concurrent responses settle in request order, including full Appearance resets and language snapshots.
- Keep the latest successful browser action authoritative when concurrent responses settle in request order, preventing rapid tab selections from reverting while retaining a successful fallback if a newer action fails.

## [1.6.0] - 2026-08-26

### Added

- Add Midnight and Sepia everyday themes plus Matrix, Machine, and Galactic cinematic themes, with matching previews, native control color schemes, address suggestions, localization, and reduced-motion-safe effects.

### Changed

- Split the renderer's global stylesheet into ordered token, base, shell, tool, collection, dialog, settings, and docking modules, and colocate toast presentation with its component.
- Move detached-panel query parsing, labels, and window-title presentation out of `App.vue` into a focused controller.

### Fixed

## [1.5.3] - 2026-08-26

### Added

- Add a zero-cost Windows Scoop package smoke test that builds the portable app locally, verifies its shortcut and loopback MCP runtime, preserves external AppData across uninstall/reinstall, and avoids consuming public release-download counts.

### Changed

- Move Help and support shell orchestration out of `App.vue` into a focused controller.
- Verify after every published release that `hronaut.dev` resolves the new version and every platform download.
- Move detached-panel refresh dispatch out of `App.vue` into a focused, exhaustively tested controller.
- Reset all Appearance preferences in one authoritative transaction and prevent conflicting settings edits while a reset is pending.
- Move Settings reset routing and Appearance defaults out of `App.vue` into a focused controller.
- Move Privacy Settings open, refresh, and search-reset lifecycle ownership out of `App.vue` into its focused shell controller.
- Move update-notification visibility and auto-dismiss timing out of `App.vue` into a focused lifecycle controller.
- Move locale-aware shell formatting out of `App.vue` into a focused reactive composable.
- Use 100% as the default interface scale for fresh profiles and Appearance resets while preserving an existing explicit scale choice.

### Fixed

- Report a failed native GitHub Repository menu action in the shell instead of only logging it.
- Report failed Help and support link navigation instead of silently closing the dialog.
- Keep committed language changes authoritative when the follow-up Home refresh fails.
- Keep committed MCP authentication changes authoritative when the follow-up Home refresh fails.
- Make tab mute and close actions keyboard-operable from the focused tab and remove invalid nested button semantics.
- Keep completed workspace storage transfers authoritative when the follow-up workspace refresh fails, and block duplicate transfers until that refresh settles.
- Keep a tab context update from canceling a newer detached-panel request, and suppress refresh failures from panels that have already been superseded.
- Reset the interface language to the system default with the rest of the Appearance preferences.
- Keep completed browsing-data clears authoritative when the follow-up website inventory refresh fails, instead of presenting the destructive clear as failed.
- Reveal the selected tab after startup when its workspace had previously been collapsed, while preserving collapse state for unrelated workspaces.
- Give workspace tabs valid tab-list semantics, keep Settings landmarks valid, and raise light-theme secondary text contrast to WCAG AA across browser controls and Settings.
- Keep crowded-tab scroll buttons in reserved space instead of covering workspace names, tab titles, and the selected-tab marker.
- Open scheme-less localhost and IP loopback development addresses over HTTP instead of forcing them through HTTPS and producing a TLS failure.

## [1.5.2] - 2026-08-25

### Added

- Show OpenCode's `opencode mcp list` connection check directly beside its Hronaut Home setup.

### Changed

- Make the selected tab unmistakable with a persistent accent marker and stronger active surface, including the collapsed vertical rail.
- Move the complete tab and application-action chrome into the left rail when tabs are placed on the left, leaving only the navigation and address toolbar across the top.

### Fixed

- Open commercial-license pricing directly in the system browser and send license API requests to the canonical domain without a redirect that can rewrite POST requests.
- Remove vertical tab overflow controls once the remaining tabs fit the full rail again.
- Keep the selected tab immediately visible when switching a crowded tab strip from the top to the left rail.

## [1.5.1] - 2026-08-25

### Added

- Let an unpinned vertical tab rail collapse to favicon width and temporarily expand for pointer or keyboard interaction.

### Changed

- Move localized keyboard-shortcut presentation out of `App.vue` into the Help controller.

### Fixed

- Keep crowded vertical tabs clear of the fixed previous/next scroll controls.
- Preserve every rapid next/previous-tab shortcut by queueing relative selections against the latest active tab.
- Wait for Electron to finish opening Developer Tools before allowing debugger-backed browser actions to continue.

## [1.5.0] - 2026-08-25

### Added

- Add a persisted top/left tab position setting with a scrollable vertical rail for crowded sessions.
- Add a workspace context action that sleeps only eligible background tabs while preserving active, pinned, busy, and unsaved-form tabs.

### Changed

- Move browser tab mutation and action-specific error policy out of `App.vue` into a focused controller.
- Move Console and Network panel shell orchestration out of `App.vue` into a focused controller.

### Fixed

- Keep a partially visible active tab in view when earlier crowded-strip items expand, while still respecting deliberate scrolling away from it.
- Prevented rapid detached Page Tools switches from refreshing a panel that was already superseded before rendering.
- Keep the active tab visible when earlier pinned tabs or workspace labels expand in a crowded strip, without overriding deliberate tab-strip scrolling.
- Cancel a queued Network refresh when the panel is closed again before it finishes opening.

## [1.4.5] - 2026-08-25

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
