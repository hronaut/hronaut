# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

### Added

- Add profile-wide Browser Essentials, Web QA, and Complete MCP tool sets, with localized Settings controls and deterministic catalogs for every connected client.
- Add local, encrypted EVM, Solana, and Tron wallets with generated, imported, watch-only, and dedicated-agent records; workspace/origin permissions; trusted approval; simulation; bounded local/testnet policy automation; and hash-chained non-secret audit history.
- Add standards-oriented EIP-1193/EIP-6963, Solana Wallet Standard, and TIP-6963 website providers, plus narrowly scoped MCP wallet list, balance, prepare, request, status, and cancellation tools that never expose or approve secrets.

### Changed

- Start new profiles with the smaller Browser Essentials catalog while preserving the Complete catalog for existing profiles.
- Keep wallet keys and pending signable message bodies in trusted main-process memory only, encrypt managed records with XChaCha20-Poly1305, wrap the vault key with secure operating-system storage, and require Argon2id passphrase protection when Linux reports `basic_text` or no secure secret backend.
- Use the MIT-licensed RustCrypto Argon2id Node-API binding for the Linux passphrase fallback so the vault works in Electron runtimes that do not compile Node's optional Argon2 API.
- Clarify when Hronaut's persistent local browser model fits better than disposable or hosted automation, and label unreleased Web3 support as a source preview rather than a shipped download feature.

### Fixed

- Bind EVM approvals to a fully prepared transaction, including nonce, gas, fee fields, and normalized transaction type, before signing.
- Keep mislabeled mainnets and unknown networks out of bounded automation even when their saved environment claims to be a testnet or local chain.
- Show trusted approval UI the exact canonical message or typed data while keeping message bodies out of durable records and agent responses.
- Reject forged wallet JSON type tags and prototype-like keys, return standards-shaped EIP-1193 errors, and present wallet-vault security states without leaking internal enum values.
- Remove horizontal crowded-tab scroll controls as soon as the tabs fit the full strip again, and keep the Home loading indicator visible in compact and collapsed layouts.
- Stop native tray attention when its requested tab or workspace closes instead of leaving a stale pulsing request behind.
- Let agents show Hronaut or request human attention before their workspace contains a browser tab, while keeping pending tabless requests visible only to their originating workspace.
- Authenticate and validate request origins before parsing MCP JSON bodies, so unauthorized malformed or oversized payloads cannot consume the parser first.
- Cancel and reject live wallet requests when a wallet is detached or removed, its account permission is revoked, or its website renderer is destroyed; clear retained message bytes and revalidate attachment and permission immediately before signing.
- Automatically zero and discard unconfirmed imported wallet secrets when their five-minute confirmation window expires, even while Settings remains idle.
- Remove a wallet's bounded automation policies when it is detached from their workspace, preventing old authorization from silently returning after a later reattachment.
- Reject expired wallet policies and path-bearing policy URLs before persistence, keeping bounded automation tied to exact HTTP or HTTPS origins that can actually match requests.
- Roll back newly generated wallets when recovery confirmation is declined or fails, instead of retaining an unusable account whose recovery phrase cannot be shown again.
- Scope Solana disconnect to the selected wallet and requesting site, cancel its pending signatures, and preserve unrelated same-origin chain permissions.
- Expire untouched wallet approval requests at their deadline, reject the waiting website caller, and clear retained message bytes without requiring a click or restart.
- Fail wallet request preparation closed so connection, transaction, and message setup errors cannot leave stale requests available for approval.
- Keep Repro recorder copy confirmation visible when a background recording refresh arrives immediately after the clipboard write.
- Keep the packaged MCP smoke aligned with the Complete tool catalog it verifies after new profiles began defaulting to Browser Essentials.

## [1.9.11] - 2026-08-28

### Changed

- Add a focused Docker/Vitest command for fast file- or case-level unit and component feedback without building or launching Electron.

### Fixed

- Treat Electron's aborted page loads as normal navigation supersession and keep stale address submissions from showing a false failure over the newer page.
- Keep delayed native workspace-editor requests from opening over a newer Settings, Help, Command Palette, or credential dialog.
- Keep keyboard and programmatic focus inside the active Hronaut modal, including reverse tabbing at the minimum window size and 125% interface scale.
- Keep the current page visible when closing it would require a sleeping replacement that cannot wake, and preserve newer tab selections while replacement restoration is pending.
- Keep the active split-view pane attached and visible when its inactive partner closes.
- Add credential-free one-click VS Code MCP setup from Hronaut Home while retaining manual setup for authenticated profiles.
- Recover Hronaut Home endpoint and client setup instructions after committed MCP or language changes even when the main-process reload fails.

## [1.9.10] - 2026-08-28

### Changed

- Move the browser tabs, title-bar surfaces, navigation controls, and page actions into a focused presentation layer while keeping application orchestration in `App.vue`.
- Speed up focused Docker/Xvfb regression runs by reusing a dependency-only image layer and bind-mounting the live checkout, while keeping the full immutable-image Docker suite as the delivery gate.

### Fixed

- Serialize native website permission prompts and revalidate queued requests before showing them.
- Preserve MCP download ownership when an archived workspace is reopened with a new workspace ID.
- Wait for in-flight workspace storage changes to finish before flushing browser profiles during shutdown.
- Let the release workflow advance the last verified Scoop manifest only after new artifacts and checksums exist, instead of blocking artifact creation on a future manifest.
- Retry transient Chromium profile-directory cleanup races in Electron integration fixtures.

## [1.9.9] - 2026-08-28

### Added

- Add a focused Docker/Xvfb Playwright command for fast file- or test-level regression feedback while keeping the full Docker suite as the delivery gate.
- Add a portable Hronaut Agent Skill for safe workspace creation, semantic browser interaction, and human handoff across skill-aware coding clients.

### Changed

- Move the page-tools and developer-panel presentation layer out of `App.vue` while preserving its controller-owned panel models and imperative handles.

### Fixed

- Keep the native Pick Element action from starting a hidden website picker behind command-palette, workspace, credential, Help, and Settings modals.
- Preserve newer human tab selections while MCP wakes a sleeping selection target, and close sleeping MCP tabs without reloading them first.
- Attribute MCP activity to the validated tab in the requested workspace, including while an omitted-target command wakes a sleeping tab.
- Keep the native Command Palette action from opening behind workspace and credential modals, so the visible dialog remains authoritative for Escape and focus handling.
- Preserve the existing browser session when Hronaut receives a quit request before cold-start tab restoration begins, instead of flushing an uninitialized empty model over `tabs.json`.
- Keep detached tool-panel switches exclusive, preserve newer user selections and close actions over queued native presentations, and keep automatic refresh bookkeeping from cancelling a newer native request.
- Wait for sleeping tabs to wake successfully before presenting them from tray and MCP attention actions, preserving the current visible tab when restoration fails.

## [1.9.8] - 2026-08-28

### Fixed

- Keep a focused address-bar selection authoritative while an earlier navigation commits, so rapid consecutive searches cannot append the new query to a redirected page URL.
- Keep Hronaut Home controls interactive while the global website-tab interaction lock is enabled.

## [1.9.7] - 2026-08-28

### Changed

- Move Downloads, Bookmarks, and History panel rendering out of `App.vue` into a focused browser-collections layer while preserving controller-owned panel refs and models.
- Consolidate active-tab presentation, origin-scoped credential filling, emulation labels, and detached-panel state behind a focused feature controller, keeping `App.vue` composition-focused.
- Extract active-tab derivation, diagnostic-log preservation, and MCP tab-activity composition from `App.vue` into a focused runtime feature controller.
- Extract full-modal state, shell geometry, and competing-overlay coordination from `App.vue` into a focused layout feature controller.
- Extract shell appearance, custom title-bar, detached-panel, tab-rail, and panel-dock presentation composition from `App.vue` into a focused feature controller.
- Extract startup task aggregation, bounded recovery, and coordinated teardown from `App.vue` into a focused feature controller.
- Update the embedded accessibility and performance audit engines to axe-core 4.13.0 and web-vitals 6.2.1.

### Fixed

- Persist profile state through one exclusive randomized atomic-file writer, preventing predictable temp-file symlinks from redirecting credentials, license data, tabs, settings, permissions, history, bookmarks, or window-state writes onto unrelated user files.
- Prefix Windows reserved device names suggested by websites before allocating download paths, while preserving normal filenames and collision-safe numbering.
- Search scheme-less email-shaped address-bar input instead of interpreting it as URL credentials, while preserving `@` characters in valid URL paths.
- Reject Windows reserved device names for requested PDF and sanitized HAR exports, and prefix title-derived reserved names so generated files remain portable across supported platforms.
- Bind native website-permission prompts to the exact requesting frame, preserving valid cross-origin iframe grants while rejecting late decisions after frame or tab navigation and destruction.
- Strip embedded HTTP credentials from bookmark and visit-history fallback titles, and repair existing credential-bearing history records instead of dropping them.
- Keep MCP download history, save paths, cancellation, and clearing isolated to the agent workspace that created each download.
- Strip embedded HTTP credentials from active and archived tab URLs before persistence, and repair credential-bearing profile state during startup.
- Recover from malformed profile MCP token files by generating one new owner-only token instead of leaving Hronaut running without a window or MCP listener.
- Keep simultaneous same-named website downloads in distinct collision-safe files instead of silently overwriting one response.

## [1.9.6] - 2026-08-28

### Added

- Add localized, profile-aware Zed setup to Hronaut Home with its remote `context_servers` schema, explicit non-OAuth marker for unprotected profiles, and live status verification.
- Add localized, profile-aware Devin Local setup to Hronaut Home with current user-scoped configuration, owner-token file interpolation, and connection verification commands.
- Add localized, profile-aware JetBrains Junie setup to Hronaut Home using the user-level MCP configuration shared by Junie CLI and JetBrains IDEs.
- Add localized, profile-aware Kilo Code setup to Hronaut Home with trusted token-file references and a connection verification command.
- Add localized, profile-aware Cline setup to Hronaut Home with explicit Streamable HTTP configuration, authentication-aware headers, approval-safe defaults, and a connection verification command.

### Changed

- Extract workspace-editor visibility and create, edit, and close routing from `App.vue` into a focused shell controller.
- Refresh patch-level application dependencies and expand release/setup-feedback client discoverability for current MCP clients.
- Extract app-level keyboard surface priority and shortcut composition from `App.vue` into a focused feature controller.
- Extract application command-palette routing from `App.vue` into a focused feature controller.
- Extract site controls, storage, privacy, and settings navigation composition from `App.vue` into a focused feature controller.
- Extract responsive-preview and environment-emulation composition from `App.vue` into a focused feature controller.
- Extract Downloads, Bookmarks, and History composition from `App.vue` into a focused browser-collections feature controller.

### Fixed

- Accept the case-insensitive HTTP `Bearer` authentication scheme used by standards-compliant MCP clients.
- Recover with safe defaults when profile persistence files contain a valid JSON value with the wrong shape instead of failing Hronaut startup.
- Make a first-instance `--quit` request exit cleanly instead of launching a new Hronaut window and MCP listener.
- Keep launch-only MCP port overrides separate from saved preferences so unrelated settings changes cannot persist the temporary port.
- Ignore unchanged MCP port submissions while the healthy listener is already running, while still allowing same-port recovery after a listener failure.
- Make concurrent first-start MCP token loads converge on one atomically published owner-only token without temporary-file collisions or token replacement.
- Include IPv6 cookie-only sites in browsing-data inventories without producing double-bracketed invalid origins.
- Persist the anonymous commercial-license installation identity on first load so activation device names remain stable across restarts.

## [1.9.5] - 2026-08-27

### Changed

- Extract panel registration, transient-panel coordination, detached-window synchronization, and developer-panel actions from `App.vue` into a focused feature controller.
- Extract page capture, export, diagnostics, and page-tools presentation composition from `App.vue` into a focused feature controller.
- Update Electron 42 to 42.10.1 for upstream window, Wayland, shutdown, printing, and renderer reliability fixes while the Electron 43+ migration remains blocked upstream.

### Fixed

- Release failed detached-panel windows and clear their runtime owner so a later detach request can retry after a renderer load failure.
- Remove malformed, duplicate, unsafe, expired, and overflow bookmark, credential, permission, and visit-history records from the persisted profile during startup repair instead of leaving filtered private data on disk.
- Strip embedded usernames and passwords from HTTP(S) bookmark URLs before storing them.

## [1.9.4] - 2026-08-27

### Changed

- Move settings, update, MCP, license, privacy, permission, credential, download, performance, and search feature composition out of `App.vue` into a focused controller.

### Fixed

- Keep replacement MCP listeners paused while port or reset settings are staging, then apply the latest pause and authentication state atomically at cutover.
- Generate Gemini CLI Streamable HTTP setup with its documented `httpUrl` schema so copied Hronaut Home configuration connects successfully.

## [1.9.3] - 2026-08-27

### Changed

- Document the release-synchronized Scoop command for installing the verified Windows x64 portable build and Start Menu shortcut.

### Fixed

- Keep MCP paused until password decryption and page injection finish, even when the user requests Resume during the fill.
- Keep MCP paused for the full browsing-data cleanup and preserve newer user or credential-fill pause intent when cleanup finishes.
- Complete renderer teardown even when one native listener or controller disposer throws, preventing later IPC subscriptions, timers, and shell resources from surviving an unmount.
- Roll back earlier native event subscriptions when a later subscription fails during renderer startup, preventing duplicate or orphaned IPC listeners after a retry.
- Roll back partially attached Downloads, Bookmarks, and History listeners when collection startup fails, allowing a clean retry without leaked or permanently missing updates.
- Fully tear down address-suggestion watchers and native overlay listeners after failed setup or shell disposal so queued work cannot reopen the overlay or navigate a page afterward.
- Roll back live MCP activity subscriptions when tab tracking cannot start and always clear agent badges, request state, and linger timers even if native listener teardown fails.
- Preserve and report the real update-service failure when listener cleanup also fails, and always clear pending update UI operations during teardown.
- Preserve MCP and commercial-license source errors through listener cleanup failures, and clear their pending UI feedback before teardown completes.
- Roll back partial title-bar listener setup and always remove remaining geometry listeners and safe-area styles when one cleanup fails.

## [1.9.2] - 2026-08-27

### Fixed

- Ignore late shell notifications after renderer teardown so delayed clipboard or browser-action failures cannot recreate toast state and timers after the app has unmounted.
- Serialize Hronaut Home status polling so a slow local MCP response cannot create overlapping requests, starve dashboard updates as stale, or accumulate pending work.
- Generate PowerShell-safe authenticated Codex and Claude Code setup commands on Windows, including token paths with spaces or apostrophes.

## [1.9.1] - 2026-08-27

### Changed

- Move panel-dock preference validation and persistence out of `App.vue` into a focused controller shared by shell layout behavior.

### Fixed

- Always release Chromium's native pointer when an element or coordinate drag fails mid-movement so later human and agent input cannot remain stuck in a pressed state.
- Keep Hronaut usable when local layout preference storage cannot be read or written, falling back to safe panel sizes and preserving live dock and workspace-collapse actions.

## [1.9.0] - 2026-08-27

### Added

- Show copy-ready connection verification commands for Codex and Claude Code on Hronaut Home, matching the existing OpenCode and Gemini CLI guidance.
- Advertise Hronaut's persistent-workspace, semantic-inspection, and human-handoff workflow through MCP server instructions during client initialization.
- Let agents hover bounded viewport coordinates to reveal tooltips and hover states on canvas, WebGL, maps, remote desktops, and other visual-only surfaces.
- Let agents drag between bounded viewport coordinates for canvas, maps, custom controls, remote desktops, and other pixel-precise targets.
- Add first-class Gemini CLI setup, authentication-aware configuration, and connection verification to Hronaut Home.
- Add a localized, copy-ready first-success task to Hronaut Home so a newly connected agent can prove isolated workspace creation, navigation, and semantic inspection immediately.

### Changed

- Move renderer startup, window-listener wiring, and idempotent resource disposal out of `App.vue` into a focused lifecycle controller.
- Move bookmark and history entry navigation out of `App.vue` into the existing browser-collections shell controller.
- Move guarded, serialized Chromium Developer Tools toggles out of `App.vue` into the browser-tab action controller.
- Move site and update settings-entry policy out of `App.vue` into a focused navigation controller.

### Fixed

- Preserve keyboard focus when switching Hronaut Home setup guides and expose the selected client as an accessible pressed button.
- Close About before opening Commercial license settings so the two modal surfaces never stack.
- Keep Find cleanup running when a competing shell action throws synchronously.
- Make the complete horizontal “Workspace” action, including its visible label, clickable instead of limiting its title-bar hit target to the plus icon.
- Keep a horizontal-only `browser_scroll` action from also applying the default vertical scroll distance.
- Prevent an older bookmark or history navigation from closing a panel that the user reopened while that navigation was still pending.
- Clear stale Downloads actions when the panel is closed so an older reveal, cancel, or cleanup cannot lock or report errors in a reopened panel.
- Keep an externally reopened Downloads panel visible when an older refresh fails after another shell action or download event changed its visibility.
- Prevent queued Network refresh and request-condition actions from running inside a panel that was closed and reopened by newer shell coordination.
- Keep diagnostic “Copied” feedback scoped to the current page and restart its confirmation timeout when the same report is copied again.
- Keep Console, Network, Site Storage, and MCP endpoint copy confirmations scoped to the latest clipboard action and current context, with full confirmation time after repeated copies.
- Keep Hronaut Home on the newest status response and prevent repeated or guide-switched setup copies from clearing, sticking, or showing stale feedback.

## [1.8.0] - 2026-08-27

### Added

- Let agents wait for full or same-document navigation to reach a wildcard URL pattern, with prompt tab-close cancellation and redacted matched URLs.
- Let agents wait for a snapshot ref or CSS selector to become attached, detached, visible, or hidden without brittle JavaScript polling.
- Let agents single- or double-click bounded viewport coordinates for canvas, WebGL, maps, remote desktops, and other visual-only surfaces without weakening the preferred semantic-ref workflow.

### Changed

- Move Home navigation, last-website tracking, and competing-surface cleanup out of `App.vue` into a focused controller.
- Left-align Home and the title/tab cluster in horizontal mode, and align the vertical rail title to its left edge while preserving native window-control safe areas.
- Move shell-wide browser, startup, search, settings, and clipboard feedback out of `App.vue` into a focused controller.

### Fixed

- Prevent an already-finished page from timing out when loading stops between `browser_wait`'s state check and lifecycle-listener registration.
- Honor accept and dismiss consistently for alerts, confirmations, and prompts opened by agent clicks without racing another dialog handler.
- Keep hidden-tab screenshots, PDF exports, and visual comparisons reliable when Chromium renders the offscreen surface but omits its first presentation callback under load.

## [1.7.0] - 2026-08-26

### Added

- Add an all-platform, restart-required “Use system title bar” fallback for desktop environments where compact window controls are unreliable.
- Add Ctrl/Cmd+1–8 direct website-tab selection and Ctrl/Cmd+9 last-tab selection for crowded horizontal and vertical tab layouts.

### Changed

- Replace the redundant main-window title row with a native-controls overlay: horizontal tabs, the vertical navigation row, and Home now provide compact drag surfaces with theme-matched controls.
- Keep the vertical tab rail in its own left column while navigation and address controls use only the right content column.
- Publish the verified Windows portable checksum into the Scoop manifest after each release, then automatically dispatch full CI and the Windows install/reinstall smoke.

### Fixed

- Match native tab-menu directions to the selected layout: vertical rails now say “Move Tab Up,” “Move Tab Down,” and “Close Tabs Below” instead of describing horizontal movement.
- Keep “Close Other Tabs,” “Close Tabs to the Right,” and “Close Duplicate Tabs” inside the selected tab’s workspace so cleanup cannot remove unrelated workspace tabs.
- Show authoritative success or failure feedback after a human PDF export, including write errors that occur after Page Tools closes.
- Keep every tab, address input, toolbar action, and menu control explicitly non-draggable, preserve bare-Alt access to the native application menu, and reserve left- or right-side window-control safe areas at narrow widths and scaled displays.
- Keep the selected crowded tab fully reachable when the window or title-bar safe area changes, including compact horizontal layouts.
- Keep MCP user-attention requests active when an agent shows or focuses Hronaut, clearing them only after real human input.
- Keep Site Storage controls locked while a write, delete, or clear is pending so rapid actions cannot overlap, show stale entries, or discard a newer edit draft.
- Reset both Memory Saver preferences in one persisted transaction so a write failure cannot leave only half of the defaults applied.
- Reset MCP authentication and its listener port as one main-process transaction so a busy default port cannot leave authentication disabled on the previous listener.

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
