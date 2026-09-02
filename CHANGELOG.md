# Changelog

All notable changes to Hronaut are documented in this file.

## [Unreleased]

## [1.11.34] - 2026-09-02

### Fixed

- Stop a human tab close from completing after **Block input** engages while Hronaut is waking the replacement tab; agent-driven closes remain available.
- Keep leaked browser, settings, and MCP status listeners inert when failed startup cleanup also throws, preserve the original initialization error, and allow a clean retry.

### Improved

- Add a GitHub support resource that routes setup, product defects, security reports, and licensing questions to focused privacy-safe channels.

## [1.11.33] - 2026-09-02

### Added

- Add copy-ready starter workflows for authenticated handoff, localhost defect triage, and responsive review with explicit workspace and privacy boundaries.

### Fixed

- Keep trusted modal cleanup from restoring stale Hronaut focus while another application owns input, and fail closed if the native focus query is unavailable.
- Invalidate later cached changelog pages after a successful refresh so newly shifted releases cannot disappear at a page boundary.
- Ignore a leaked native update listener after failed startup cleanup so stale release state cannot overwrite a successful retry.
- Refresh transitive URI and query-string parsing dependencies to patched BSD-licensed releases after newly published host-confusion, SSRF, and denial-of-service advisories.
- Close active Chromium connections when tearing down integration HTTP fixtures so otherwise-passing Docker cases cannot spend their timeout waiting on idle sockets.
- Stop panel-dock watchers, queued layout IPC, and active resize listeners when the shell layout controller is disposed.
- Roll back page capture, export, and diagnostics resources when page-tools panel composition fails during application startup.
- Let focused static validation accept intentionally ignored documentation files without turning ESLint's ignored-file notice into a false failure.

### Improved

- Make Hronaut's published Agent Skill discoverable for authenticated browser QA, localhost and responsive testing, accessibility checks, and performance diagnosis.
- Add copyable GitHub attestation and SHA-256 verification steps for unsigned release downloads to the README.
- Serialize focused Docker dependency-cache initialization so concurrent cold starts cannot observe a partially populated cache.
- Split hosted Electron integration coverage across three balanced shards to shorten feedback while retaining all scenarios.
- Keep `App.vue` composition-focused by grouping page-tools and panel wiring, owned surface handles, and lifecycle cleanup in a dedicated controller.

## [1.11.32] - 2026-09-02

### Fixed

- Stop delayed address-navigation errors and site-summary responses from updating the shell after its navigation controller has been disposed.
- Show trusted wallet approval requests immediately for MCP agent signing and transaction operations instead of waiting for an unrelated UI refresh or window resize.
- Make the What's new Refresh action bypass its short-lived GitHub cache while retaining cached release history as an offline fallback.
- Keep generated GitHub release notes focused on version changes instead of repeating the product demo, downloads, setup clients, and license introduction.
- Prevent concurrent DOM-changes panel refreshes from leaving the trusted diagnostics UI stuck in a loading state.
- Keep release reruns from treating retained Playwright diagnostics as downloadable application assets.

## [1.11.31] - 2026-09-02

### Added

- Add a guided Home troubleshooting path that opens the MCP connection check in the system browser and offers a privacy-safe way to report unresolved setup trouble.

### Fixed

- Keep troubleshooting visible when an agent's first tool call fails, and only enable setup referrals after at least one successful agent action.
- Keep the Home success card aligned with its available feedback and recommendation actions instead of showing stale connection and licensing guidance.
- Prevent agent-driven scrolling from reclaiming keyboard or mouse focus on Linux while Hronaut is in the background, including when page input is blocked.

### Improved

- Publish human-readable titles and conservative MCP safety annotations for every tool so compatible clients can distinguish pure inspection from browser, storage, file, and wallet actions without weakening Hronaut's enforced boundaries.
- Keep `App.vue` composition-focused by moving shell interaction routing, keyboard precedence, and shortcut lifecycle handling into a dedicated controller.
- Reuse focused Docker dependency images and volumes across release-only version bumps while still invalidating the cache when dependencies, the dependency lock graph, or the test image changes.

## [1.11.30] - 2026-09-02

### Added

- After its first successful agent action, Hronaut Home can copy a privacy-safe recommendation with an attributable public link, without including browser, workspace, or agent data.

### Fixed

- Keep Hronaut from reclaiming keyboard or mouse focus when the user leaves the app during an already-running agent action, including after **Block input** is enabled.
- Prevent automatically opened trusted dialogs, including wallet approvals, from taking keyboard focus when Hronaut is in the background.
- Prevent an obsolete detached-panel open failure from redocking a newer panel selection.
- Keep the enabled workspace New Tab button, keyboard shortcut, and context-menu action usable while global page input is blocked; newly opened pages remain protected by the same lock.
- Keep trusted element and screenshot-area selection responsive on locked pages when an agent click, key press, or other input finishes while the human selection is still active.

## [1.11.29] - 2026-09-02

### Added

- After Hronaut completes its first agent tool call, Home offers a privacy-safe **Share your setup result** action that opens the existing structured GitHub feedback form in the system browser without attaching runtime data.

### Improved

- Rename the global tab-lock control to **Block input** and clarify across all supported languages that it blocks human website input and tab closing while Hronaut controls and agents keep working; foreground-focus protection remains automatic regardless of this setting.

## [1.11.28] - 2026-09-02

### Added

- Add first-class Windsurf Cascade setup on Hronaut Home, including Streamable HTTP configuration, connection verification, and owner-token file interpolation that avoids copying authentication secrets into JSON.

### Fixed

- Prevent background agent input from activating Hronaut when Electron restores the main window's focusability, including while tabs are locked on Linux desktop environments that focus a window during that transition.

## [1.11.27] - 2026-09-02

### Fixed

- Prevent background MCP JavaScript evaluations from taking keyboard or mouse focus from the application a person is using; unexpected dialogs are safely dismissed on isolated evaluations, while DevTools-open tabs retain compatible guarded evaluation.

## [1.11.26] - 2026-09-02

### Fixed

- Keep MCP `browser_evaluate` alert and confirm handling from activating Hronaut while a person works in another application, and preserve explicit accept/dismiss behavior on pages whose Content Security Policy blocks page-level `eval`.

## [1.11.25] - 2026-09-02

### Fixed

- Prevent trusted agent clicks from activating the Hronaut window while the person is working elsewhere, including when Lock Tabs temporarily permits agent input to a locked page.

## [1.11.24] - 2026-09-02

### Fixed

- Agent presentation and attention requests no longer steal keyboard or mouse focus when their target is already visible in split view.

## [1.11.23] - 2026-09-01

### Fixed

- Keep MCP `browser_show` non-activating even when Lock Tabs is off, so an agent can reveal Hronaut for observation without taking keyboard or mouse focus from the application a person is using.

## [1.11.22] - 2026-09-01

### Added

- Add trusted per-workspace Site access policies with exact origins, boundary-safe subdomain wildcards, and loopback port wildcards. Restricted policies cover direct and MCP navigation, redirects, page links and forms, popups, and back/forward history; they persist across restart and archive/restore while agents remain unable to change them.
- Add a bounded, trusted blocked-navigation log that records only origin, reason, source, and time without persisting denied paths, queries, fragments, or embedded credentials.

### Fixed

- Treat a policy-blocked redirect as an intentional cancellation instead of surfacing a generic Chromium load failure.
- Check back and forward targets before Chromium changes history so a disallowed origin cannot bypass a workspace policy.

## [1.11.21] - 2026-09-01

### Fixed

- Prevent the MCP `browser_show` tool from taking foreground keyboard or mouse focus while Lock Tabs is active; agents can still make the window visible without interrupting work in another application.

## [1.11.20] - 2026-09-01

### Fixed

- Keep Lock Tabs from moving keyboard or mouse focus into Hronaut chrome when its state changes, while retaining the native input barrier that blocks physical interaction with locked website pages.
- Reject credential-bearing HTTP(S), `view-source:`, and origin-bound `blob:` URLs across agent workspace navigation so embedded usernames or passwords cannot enter live tabs through direct commands, redirects, or website popups.

### Improved

- Make release auto-tagging idempotent when a matching signed tag is published concurrently, while still failing closed if the remote tag points at another commit.

## [1.11.19] - 2026-09-01

### Fixed

- Block local-file and privileged/internal-scheme navigation in agent-owned workspace tabs, including direct commands, redirects, popups, and restored profile state, so MCP browser access cannot become an unrestricted local-content viewer. Existing unsafe persisted tabs are repaired to blank documents without preventing startup. Normal web, embedded QA, and origin-bound blob documents remain supported; the explicit file-upload tool still attaches agent-supplied local paths only to website file inputs.

## [1.11.18] - 2026-09-01

### Fixed

- Preserve the human's active window and trusted-chrome focus across agent clicks, typing, and key presses, including when page input is locked, so background MCP work cannot reactivate Hronaut and capture physical keyboard or mouse input.

## [1.11.17] - 2026-09-01

### Fixed

- Keep trusted wallet approvals above website content even when a delayed shell measurement arrives, so connection, signing, and transaction confirmations no longer appear only after resizing the window.
- Point the desktop repository's static reference site at the canonical Hronaut storefront and provide complete large-card Open Graph metadata instead of identifying GitHub as the shared page.

### Improved

- Keep the reference site's appearance copy aligned with all eight built-in palettes plus System mode.

## [1.11.16] - 2026-09-01

### Fixed

- Keep Wallet Standard `silent` and legacy `onlyIfTrusted` Solana reconnect checks from opening trusted approval UI before a site has address permission.
- Support the `off` event-listener cleanup used by maintained Solana wallet adapters so disconnecting cannot stall before Hronaut receives the request.
- Wait for the persisted tray-close preference before exercising process shutdown in release validation, removing a race that could leave the test app hidden in the tray and block otherwise valid packages.
- Shut down wallet brokers before deleting their temporary vaults in unit tests so background confirmation and audit work cannot race test cleanup on slower runners.

## [1.11.15] - 2026-09-01

### Release status

- Not published: release validation detected a wallet broker teardown race before any binaries were built. The fixes are included in 1.11.16.

## [1.11.14] - 2026-09-01

### Release status

- Not published: release validation detected a flaky tray-close test before any binaries were built. The fixes are included in 1.11.15.

## [1.11.13] - 2026-09-01

### Fixed

- Publish legacy Solana `publicKey` and connection state after selecting Hronaut so compatible dapps stop waiting and can continue to their trusted approval flow.
- Dispatch agent keyboard shortcuts through Chromium's awaited input channel so background-focus races cannot report a successful key press that the page never received.

## [1.11.12] - 2026-09-01

### Fixed

- Hide native website views while trusted Hronaut dialogs are open so wallet approvals appear immediately after a dapp selects Hronaut, without requiring a window resize, and restore the page between consecutive requests.

## [1.11.11] - 2026-09-01

### Changed

- Clarify Wallets onboarding with descriptive Generate, Import, and Watch-only choices, outcome-specific actions, a distinct wallet-management state, signing-key controls only when a signing wallet exists, and an automatic handoff to the newly added wallet without leaving duplicate-ready form values behind.

### Fixed

- Reveal the GitHub-backed **What's new** reader immediately above normal website content without requiring a window resize, including at the minimum supported window size.
- Refresh Responsive Preview controls from the applied tab viewport after closing and reopening during a pending Apply, without letting an older failure overwrite a newer draft.
- Reveal trusted wallet connection and signing approvals immediately above website content without requiring a window resize, and keep approval actions visible while reviewing long requests.
- Refresh Environment controls from authoritative tab state when a pending Apply finishes across close and reopen cycles, without letting an older failure overwrite a newer draft.
- Keep the Workspace editor visible and clearly busy while saving, closing, or copying browser data; block every dismissal and conflicting edit path until the authoritative operation finishes.
- Keep validated wallet imports visible and immutable until trusted cancellation finishes, preventing a stale cancellation from colliding with a newer onboarding attempt.
- Keep wallet rename and RPC drafts open for retry when persistence fails, prevent conflicting inline editors, and lock drafts while their update is in flight.
- Keep transaction-automation drafts scoped to the selected signing wallet, clear successful policy forms to prevent accidental duplicates, and reject misleading bounded automation policies for watch-only wallets.
- Cancel validated wallet imports when the trusted Wallets panel closes or changes sections so abandoned recovery material is removed from signer memory immediately instead of waiting for expiry.
- Let hidden full-page screenshots use Chromium's own capture presentation path instead of waiting on an unrelated compositor subscription that can be missed under load.

## [1.11.10] - 2026-09-01

### Fixed

- Send a plain-data wallet import confirmation through Electron IPC so validated mnemonic and private-key imports can be encrypted instead of failing with a data-clone error.

### Improved

- Make wallet imports a clear two-step flow that moves focus to a public-details review, explains when local encryption occurs, shows workspace access, and provides an explicit **Add encrypted wallet** action.

## [1.11.9] - 2026-08-31

### Fixed

- Keep every trusted Settings descendant outside title-bar drag regions so Wallet form fields and selectors remain interactive after locking and unlocking tabs.

## [1.11.8] - 2026-08-31

### Fixed

- Return the canonical cancellation result when wallet removal races request preparation, instead of exposing an internal approval-state transition error to the website provider.

## [1.11.7] - 2026-08-31

### Added

- Add a privacy-safe general bug-report form with reproducibility fields and explicit guidance to keep browser, wallet, and MCP secrets out of public issues.

### Improved

- Restyle the GitHub-backed **What's new** history as a compact release reader with date/version headers, denser categorized notes, and a narrower scrollable dialog.

### Fixed

- Drain queued bookmark, credential, site-permission, and commercial-license writes during shutdown so recent changes are not lost when Hronaut quits immediately after an action.
- Keep a newer wallet-vault lock or application shutdown authoritative when an asynchronous unlock is still waiting on the operating-system credential store, preventing stale completion from restoring decrypted key material.
- Restore the cached What's new history to a ready state when its dialog closes during a refresh, instead of leaving the controller permanently marked as loading.

## [1.11.6] - 2026-08-31

### Changed

- Add a three-step first-run path, workflow links, platform/CI badges, and machine-readable package discovery metadata to make the public repository easier to evaluate and adopt, and send first-time downloads through the curated OS/package chooser instead of GitHub's raw asset list.
- Link future unsigned-package release warnings directly to the SHA-256 and GitHub attestation verification guide.

### Fixed

- Drain queued browsing-history writes during shutdown so the final visit is not lost when Hronaut quits immediately after navigation.
- Hand the GitHub-backed **What's new** view off from Settings and About instead of stacking multiple `aria-modal` dialogs, keeping focus and assistive-technology semantics on one trusted surface.
- Treat **What's new** as a real keyboard modal so Escape closes it and application shortcuts cannot execute behind it.
- Keep older stable releases reachable when a GitHub history page contains only filtered prereleases.
- Repair the public security-policy link and guard repository-relative README links against future 404s.

## [1.11.5] - 2026-08-31

### Added

- Add a trusted, paginated **What's new** view in About and Software updates that renders sanitized notes from GitHub Releases, keeps GitHub as the single source of truth, and retains recently loaded history when the network is temporarily unavailable.

## [1.11.4] - 2026-08-31

### Fixed

- Disable configured-wallet mutations while another wallet operation is still refreshing, preventing a fast second click from being silently discarded.

## [1.11.3] - 2026-08-31

### Fixed

- Close Chromium keep-alive connections before local HTTP fixture teardown in long Electron shards, preventing completed shell tests from exhausting the global timeout during cleanup.
- Keep EIP-1193 accounts scoped to the active chain, switch among configured workspace networks with the required provider events, route signing to the requested permitted account, and notify connected dapps when account access changes after vault locking, permission revocation, wallet removal, or network fallback.
- Drive wallet-request expiry regression timing with a controlled clock so loaded CI runners cannot let the fixture expire before the test captures it.
- Scope native input-guard failure injection to the lock operation under test so background debugger synchronization cannot consume the one-shot failure on loaded CI runners.

## [1.11.0] - 2026-08-31

### Added

- Add chain-aware wallet onboarding with curated EVM, Solana, and TRON network presets, editable RPC endpoints, a full custom-network path, and explicit public-RPC/mainnet safety guidance.
- Let each wallet use either an explicit workspace allowlist or an opt-in **Any workspace** scope that also covers future workspaces, without granting address or signing permission.
- Let a dedicated EVM agent wallet opt into a short-lived, fully bounded **Bypass Approve** policy for exact mainnet agent transactions, while websites and requests outside the delegation still require trusted approval.

### Fixed

- Explain wallet-vault locking in context, make it reliably clear OS-protected signing keys from memory, and provide a system-secure-storage unlock path without requesting an irrelevant passphrase.
- Switch wallet imports between a mnemonic phrase textarea and a masked private-key field, clearing any entered secret when the format changes.
- Let configured wallets replace a failed or rate-limited RPC endpoint without recreating their signing identity, while cancelling pending requests and removing endpoint-bound automatic policies.
- Replace Electron's unsupported wallet-rename prompt with an inline trusted editor, and add accessible labels to vault passphrase controls.
- Require an explicit saved workspace selection for bounded wallet policies, preventing policies from silently targeting the first attached workspace.
- Keep bounded-policy submission disabled until its origin, destination, method, limits, expiry, and operation count are valid.
- Validate trimmed custom network identifiers, names, and HTTP(S) RPC URLs before wallet submission, while accepting harmless surrounding whitespace in EVM chain IDs.
- Return a normal validation error for partially typed or malformed wallet RPC URLs instead of letting URL parsing throw from the shared schema.
- Show public-RPC rate-limit guidance only for presets that actually use a public endpoint, not local or custom networks.
- Revalidate automatic-policy expiry and mainnet Bypass Approve invariants at the final serialized signing boundary, preventing a queued transaction from signing after its delegation expires.
- Scope active and archived MCP workspaces to the creating connection, hide other clients' identifiers and label collisions, preserve workspace identity through archive recovery, return a private cleanup capability for retained failed forks, and require that capability before a reconnect can recover persistent browsing state.
- Require human approval for Solana and TRON public-testnet signing until their RPC endpoints can be independently attested, preventing a retained testnet label paired with a mainnet RPC from authorizing automatic transactions.
- Validate custom EVM chain IDs inline and in every trusted wallet-creation path, preventing malformed or unsafe IDs from being persisted and failing later during RPC operations.
- Keep configured wallet RPC endpoints, embedded transport credentials, raw adapter failures, and simulation logs out of MCP responses and durable approval state.
- Keep EVM, Solana, and TRON network identity fields synchronized when switching chains instead of retaining incompatible IDs and endpoints from the previous family.
- Freeze validated import details until confirmation or cancellation so a prepared secret cannot be saved with another chain family's network metadata.
- Keep new-wallet workspace choices independent from the configured-wallet access editor.
- Keep the selected settings section visible at narrow window sizes by using a compact horizontally scrollable navigation strip.
- Route ordinary vertical mouse-wheel input through the responsive Settings section rail without trapping page scroll at either boundary.
- Replace stale Scroll and Celo testnet RPC presets, correct Sonic Testnet's chain ID, and remove the deprecated Taiko Hekla preset.
- Publish message-signing approvals only after their simulation audit is durable, closing a permission-revocation race exposed by hosted CI.

## [1.10.1] - 2026-08-31

### Fixed

- Keep the trusted Settings surface outside Electron title-bar drag regions so wallet names, native selectors, and other controls remain interactive across tab layouts, locked pages, and scaled interfaces.
- Prepare the packaged Windows profile with the Complete MCP tool set before exercising persistence, so the Scoop install smoke verifies its intended `browser_evaluate` workflow instead of failing against the new Browser Essentials default.

## [1.10.0] - 2026-08-30

### Added

- Add profile-wide Browser Essentials, Web QA, and Complete MCP tool sets, with localized Settings controls and deterministic catalogs for every connected client.
- Add local, encrypted EVM, Solana, and Tron wallets with generated, imported, watch-only, and dedicated-agent records; workspace/origin permissions; trusted approval; simulation; bounded local/testnet policy automation; and hash-chained non-secret audit history.
- Add standards-oriented EIP-1193/EIP-6963, Solana Wallet Standard, and TIP-6963 website providers, plus narrowly scoped MCP wallet list, balance, prepare, request, status, and cancellation tools that never expose or approve secrets.

### Changed

- Keep `App.vue` composition-focused by moving tab search, find, zoom, browser collections, workspace editing, credential selection, and the command palette into one focused transient shell layer with a narrow imperative surface.
- Keep `App.vue` composition-focused by moving Settings, trusted wallet approval, and Help mounting into a dedicated dialog layer with explicit controller contracts.
- Keep Hronaut Home aligned with the public client matrix by adding profile-aware Kiro, Mistral Vibe, and Warp setup guides, including environment-backed credentials where those clients support them.
- Parallelize standalone incremental typechecks with a constrained-runner override, run release validation concurrently, and stop repeating successful type analysis in dependent platform packaging jobs.
- Run the two hosted Electron shards on isolated runners and record Playwright traces only on a strict first retry, shortening successful Docker gates without accepting flaky tests.
- Add a warm full-suite Docker preflight that reuses lock-keyed dependencies, skips duplicate type analysis, and runs the complete Electron and native-dialog suite across six local shards while preserving the immutable authoritative gate and two-shard hosted profile.
- Add a focused static validation command that runs content-cached ESLint concurrently with only the incremental TypeScript projects affected by the edited files, and include website TypeScript in both focused and full lint coverage.
- Synchronize physical X11 pointer and wheel delivery in Docker interaction-lock QA so concurrent Electron shards cannot mistake an undelivered probe for a still-locked page.
- Keep setup feedback and generated release guidance aligned with all fourteen focused coding-agent guides, so users can identify their actual client instead of falling back to a generic category.
- Link every focused coding-agent setup guide from the GitHub README so visitors can move directly from their client to the local Hronaut connection flow.
- Avoid repeating the full TypeScript analysis inside hosted Docker integration after the parallel validation job has already run it, while retaining typechecking in standalone Docker runs.
- Keep Docker's dependency layer keyed to the lockfile instead of unrelated package-script metadata, build the application once, and run the authoritative Electron suite across isolated Xvfb and MCP-port shards; focused Electron feedback also skips duplicate type analysis, targeted TypeScript and lint commands avoid unrelated work, and full lint uses a content-addressed cache.
- Reuse lock-keyed focused Docker dependency volumes, cap CI Vitest projects at two isolated fork workers, and provide an incremental full-project typecheck for faster repeated feedback without weakening the clean full gates.
- Start new profiles with the smaller Browser Essentials catalog while preserving the Complete catalog for existing profiles.
- Keep wallet keys and pending signable message bodies in trusted main-process memory only, encrypt managed records with XChaCha20-Poly1305, wrap the vault key with secure operating-system storage, and require Argon2id passphrase protection when Linux reports `basic_text` or no secure secret backend.
- Use the MIT-licensed RustCrypto Argon2id Node-API binding for the Linux passphrase fallback so the vault works in Electron runtimes that do not compile Node's optional Argon2 API.
- Clarify when Hronaut's persistent local browser model fits better than disposable or hosted automation, and document the Web3 trust model, mainnet approval boundary, and testnet automation limits.

### Fixed

- End a missed hidden-page frame subscription before probing readiness with Electron's independent page capture, preventing tray screenshots from timing out under concurrent renderer load.
- Roll back per-tab and global interaction-lock state when Chromium rejects a native input-guard update, including actively removing a partially applied compositor lock so websites cannot remain frozen behind an unlocked UI.
- Clean every wallet startup listener when initialization fails, preserving the source failure alongside any cleanup errors instead of leaking later listeners or masking the cause.
- Subscribe to wallet-service events before reading startup snapshots, preventing status, account, and approval changes during Settings bootstrap from being lost.
- Keep live wallet status and descriptor events authoritative over delayed post-operation snapshots, and stop refresh work cleanly when Settings disposes its wallet controller.
- Keep live wallet-request events authoritative over delayed Settings refreshes, preventing cancelled or expired approvals from reappearing and ensuring overlapping refreshes cannot restore older state.
- Keep trusted browser shortcuts available when only the focused website tab is interaction-locked, while continuing to block page keyboard input and global-lock tab closure.
- Replace the obsolete external-wallet proposal and its broken design-document link in the detailed reference with the implemented local EVM, Solana, and Tron wallet trust model and canonical security documentation.
- Verify Tron transaction JSON against its canonical protobuf bytes and transaction hash at normalization, simulation, signing, and broadcast boundaries, preventing substituted or post-approval-mutated data from being signed.
- Reject negative or unsafe EVM chain IDs and transaction nonces outside JavaScript's safe integer range instead of accepting invalid networks or silently rounding values before simulation, approval, and signing.
- Make MCP `browser_press` insert the intended shifted printable character, so combinations such as `Shift+x`, `Shift+1`, and `Shift+/` produce `X`, `!`, and `?` instead of their unshifted text.
- Store managed wallet descriptors, permissions, policies, and durable automation counters in one encrypted authenticated vault authority state; require a one-shot current-process authorization before key release; reject managed/watch-only identity collisions; migrate legacy plaintext authority by revoking grants and converting bounded automation to Always ask; and prevent an in-flight automatic request from signing after its selected policy is removed or tightened.
- Keep Home, normal browsing, tray, and non-wallet MCP tools available when wallet metadata is malformed or encrypted vault records fail authentication; disable wallet operations with a sanitized failure state, preserve damaged files for recovery, authenticate every encrypted record before reporting the vault ready, and survive Linux keyring availability changes without misclassifying valid passphrase vaults.
- Prevent physical mouse-wheel and compositor scrolling from bypassing per-tab or global website interaction locks, while keeping keyboard shortcuts, Hronaut Home, and trusted agent scrolling available.
- Give hidden tray screenshots enough bounded time to acquire a Chromium compositor frame under concurrent renderer load, while letting PDF export use Electron's independent print pipeline instead of waiting on a frame it does not consume.
- Drain in-flight wallet confirmation and audit work within a bounded shutdown window before locking the vault, preserve unresolved submitted transactions for restart recovery, and stop confirmation or expiry timers from racing disposed wallet state.
- Treat a tab closed during address navigation as a cancelled request instead of showing a false navigation failure after its replacement tab is active.
- Keep concurrent static validation from racing ESLint against Electron Vite's short-lived generated config bundle.
- Reject secret-bearing wallet payloads at every supported nesting level, fail closed when public/provider input exceeds the shared serialization depth, and reject oversized or sparse arrays, shared-reference graphs, and over-budget binary views before expansion, preventing deeply nested secrets and payload-amplification denial of service from reaching the trusted wallet broker.
- Give the theme picker proper radio-group keyboard behavior with one Tab stop plus wrapping Arrow, Home, and End navigation across all regular and expressive themes.
- Treat a sleeping tab closed during restoration as a cancelled selection instead of surfacing a false destroyed-renderer error after the healthy fallback tab is already active.
- Expose each workspace tablist's actual horizontal or vertical orientation to assistive technology so screen-reader guidance matches its arrow-key behavior.
- Speed up repeat validation with cached incremental typechecking, concurrent static gates, tunable Vitest workers, balanced four-way local Docker Electron sharding, and a resource-safe two-shard hosted CI profile.
- Trap keyboard focus inside trusted wallet approvals so a newly presented request cannot leave typing or tab navigation in the underlying website.
- Preserve Page Tools and other shell panels when the global interaction lock blocks a Developer Tools shortcut.
- Invalidate wallet request contexts synchronously on page navigation or tab closure and roll back overtaken account grants, preventing delayed preparation or permission persistence from authorizing a page that is no longer active.
- Preserve the wallet security guide when rebuilding the generated website output instead of deleting it during output cleanup.
- Bind wallet authorization sessions to server-issued MCP transport sessions, preventing another client from reusing a disclosed wallet session token even when both clients present the same User-Agent, removing terminated clients from live dashboard state, and keeping live MCP tool-set changes effective for connected clients.
- Drain and revoke in-flight agent wallet operations before MCP session termination or application shutdown completes, preventing late approval creation or bounded testnet signing after the requester has gone away.
- Keep wallet and tab lifecycle authorities available until MCP shutdown has durably cancelled agent approvals, so a clean application exit cannot leave them awaiting human action.
- Wait for MCP wallet-session request cancellation during listener shutdown, and contain cancellation failures instead of leaving cleanup in flight or producing an unhandled rejection.
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
- Always settle wallet callers and clear retained message bytes after approval, rejection, cancellation, revocation, or expiry, even when audit persistence fails after the terminal state change.
- Keep polling submitted wallet transactions until confirmation becomes terminal, resume confirmation tracking after restart, and record submission and confirmation in the immutable audit history.
- Keep MCP wallet addresses hidden from request-status and cancellation responses until account permission is active, and bind those operations to the exact page origin and navigation that created the request.
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
