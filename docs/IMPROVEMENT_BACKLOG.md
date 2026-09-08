# Improvement research and QA queue

Reviewed 2026-09-08 against the current README, REFERENCE, renderer controllers,
and shared audit contracts. These are proposals, not shipped features.

## Priorities

1. **Accessibility comparison across a fix.** Hronaut already runs bounded axe
   audits and has performance baselines. Add a similarly explicit, tab-scoped
   accessibility baseline with new, remaining, and resolved findings. Compare
   rule and target fingerprints rather than page HTML; flag changed audit scope,
   engine, URL, and truncated results so omitted findings are never called fixed.
   Playwright documents fingerprint snapshots for tracking known violations:
   [accessibility testing](https://playwright.dev/docs/accessibility-testing).
   Acceptance coverage should include reordered targets, duplicate targets,
   missing findings in truncated reports, navigation, and tab closure.

2. **Repro evidence navigation.** The existing recorder already exports a
   Playwright skeleton. Improve review by letting users select a recorded step
   and clearly see its action, target, and relative time. Playwright's
   [Trace Viewer](https://playwright.dev/docs/trace-viewer) demonstrates the value
   of reviewing actions in sequence. Hronaut should retain its existing bounded,
   redacted recording contract. This proposal does not require storing DOM
   snapshots or credentials. Verify keyboard selection, empty and capped
   recordings, and stale selection after a new recording.

3. **CSS edit review.** Investigate whether Hronaut's existing design and
   inspection tools need a compact view of deliberate style edits with copy and
   revert actions. Chrome's
   [Changes panel](https://developer.chrome.com/docs/devtools/changes) provides
   a reference for reviewing changes. First verify actual editing workflows and
   debugger ownership; do not add a second competing editor without evidence.

## Rotating QA review

### Electron upgrade evidence (issue #1)

Rechecked 2026-09-08. The upstream stable-release prerequisite is now satisfied:
[Electron 44.1.0 release notes](https://github.com/electron/electron/releases/tag/v44.1.0)
explicitly include the Linux tray fix from
[backport #53214](https://github.com/electron/electron/pull/53214).
[Electron 44.2.0](https://github.com/electron/electron/releases/tag/v44.2.0),
published September 4, is the latest stable release observed in this check.
The [commit comparison](https://github.com/electron/electron/compare/bb27a30d9262e4ad6e1eb12921d5792fa7175e96...v44.2.0)
places its tag 47 commits ahead and zero behind the tray backport merge, with
that merge as the merge base. This verifies inclusion, not only issue closure.

Keep the current pin until the remaining packaged-app checks in
[Hronaut #1](https://github.com/hronaut/hronaut/issues/1) are fulfilled: GNOME with
AppIndicator, KDE plus Xfce or Cinnamon evidence, icon/click/menu/attention/quit
behavior, Windows/macOS lifecycle smoke, dependency audit, and full Docker gates.
Do this as a separate dependency batch after the audit receipt feature is verified.

Next code-review lead: `useDiagnosticsController` also identifies its active
document by tab ID and URL. Reproduce same-URL reload behavior for pending audits
and completed reports before deciding how navigation should affect docked versus
detached panels and long-running recorders. Preserve intentional cross-navigation
performance baselines. This is a review lead, not a validated finding.

- Pending actions: success and rejection after navigation, same-URL reload,
  tab switch, dialog close/reopen, and disposal; newer actions must retain state.
- Workspace transfers: empty source, deselected origins, archived source and
  destination, source removal while loading, partial cleanup, and refresh failure.
- UI: keyboard focus, minimum window size, large interface scale, long translated
  labels, detached panels, and empty/error/loading states.
- For every reproduced bug, demonstrate a failing regression test before fixing
  it. Run focused Docker tests during iteration and the immutable Docker/Xvfb
  integration gate before delivery. Preserve failure evidence and distinguish
  product failures from setup or resource failures.
- Release a coherent verified batch through the existing immutable-tag workflow,
  with Unreleased notes, static gates, Docker integration, and platform packaging.
  Passing automation is evidence of covered behavior, not proof of zero bugs.

## Test infrastructure follow-up

- Split the large MCP capability tour into independently initialized interaction,
  storage, network, and diagnostics cases. The September 8 run reached 530
  assertions before the old 45-second deadline; its complete no-retry run passed
  in about 96 seconds with the per-test slow annotation. Splitting should preserve
  every assertion and fixture cleanup while improving failure localization.
- Investigate Electron trace completeness. The retained capability failure ZIP
  contained `test.trace` and resources, but no browser snapshots. Check explicit
  tracing of the Electron context and prove that a deliberate synthetic failure
  produces usable shell screenshots and snapshots before changing CI retention.
