# Hronaut cloud-worker handoff — 2026-09-30 02:29 UTC

The local maintenance loop is PAUSED by explicit user request. Do not resume local engineering concurrently with the cloud worker. This branch contains checkpoint evidence only; no arrow implementation change is applied. Do not merge these checkpoint files into product main.

## Remote and source

- Remote: https://github.com/hronaut/hronaut.git
- Verified main: `fd7f7312327e333d7d0221c0e95d47df5ab8ba2a`.
- Main CI: https://github.com/hronaut/hronaut/actions/runs/36658787874 — success.
- Main CodeQL: https://github.com/hronaut/hronaut/actions/runs/36658787870 — success.
- Actual logs: 3,775 tests / 446 files; 602 Electron cases in all eight pinned Docker shards; native-dialog pass; no retry/flaky markers. Static validation includes lint, typecheck, unit/component tests and application build.
- PR https://github.com/hronaut/hronaut/pull/292 merged normally after its full gates. Branch `fix/network-related-request-race` has original signed head `1cb8085ab606d520b2200361600a413dd3bae60b`; squash merge is verified main above.
- Open PRs: https://github.com/hronaut/hronaut/pull/291 (production dependency group), https://github.com/hronaut/hronaut/pull/290 (development group). No arrow or workspace-error PR exists. No active engineering CI runs at checkpoint.

## Current priority: improve recorded arrows

User: “Also in video recodring ideally if drawed arrows will have better design”. Improve actual recorded/exported arrows, preserving usability, coordinates, timing and output. Regression coverage, actual visual screenshot/video-frame QA, signed draft PR first, CI/full pinned Docker gate before merge. CI-first instruction: avoid redundant local test suites. Do not weaken protections or disable signing. This pause does not authorize a merge or release in the local worker.

Read these existing files first:

- `src/renderer/src/video/draw.ts`: shared Canvas `arrow()` draws standalone arrows and callout pointers.
- `src/renderer/src/video/layout.ts`: text-card layout.
- `src/renderer/src/video/export.ts`: actual WebCodecs/VP9/WebM frames call `drawVideoAnnotations`.
- `src/renderer/src/components/VideoRecorder.vue`: recorder/editor controls.
- `src/shared/video.ts`: normalized coordinates, source-millisecond timing, curvature [-1,1], annotation schema.
- `tests/renderer/video-annotations.test.ts`: Canvas regression coverage.
- `tests/integration/video-recording.e2e.ts`: real capture/encode/decode and visual assertions; existing `annotation-styles.png` and `.webm` screenshots/artifacts.

Actual baseline screenshot: `video-arrows/before.png`. It was rendered with the current source module in a real Chromium Canvas, using synthetic light/dark page controls. It is a renderer baseline, not an exported Electron video. The thin shaft, small unoutlined triangle head and tail dot are visible; fixed-size heads can be disproportionate for short/early animation segments.

Proposed focus communicated to user: smoother rounded shaft and chevron head, restrained contrast halo for light/dark/busy pages, proportional head size for short arrows/early drawing frames. No implementation has been applied or visual after-state produced. The queued edit was rejected by automatic approval review because the newer pause instruction arrived; do not bypass that rejection locally.

`video-arrows/render-baseline.cjs` preserves the exact QA harness. It bundles actual `draw.ts` with esbuild and calls it in a Playwright canvas. Paths are from the local execution environment; adjust them in the cloud worker, using its installed/pinned Chromium. Local Node was selected with `ASDF_NODEJS_VERSION=24.14.0`. Cached Chromium was `/home/hronom/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`; Playwright 1.63.0. Browser launch required sandbox escalation locally. This screenshot run was explicitly requested visual QA, not a redundant local test suite.

## Other unfinished work, preserved remotely

`fix/workspace-open-errors` at signed commit `c6da2f86b22050cf4a844f35bc7134887c4425d8` is a separate unfinished batch. Fetch it after arrow work if still applicable. It is NOT tested by CI, NOT a PR, NOT merged, and NOT counted as a verified unreleased improvement.

Five files, 92 insertions / 5 deletions:

- `CHANGELOG.md`
- `src/renderer/src/components/WorkspaceEditor.vue`
- `src/renderer/src/composables/useWorkspaceEditorController.ts`
- `tests/renderer/workspace-editor-controller.test.ts`
- `tests/renderer/workspace-editor-dialog.test.ts`

Actual source reproduction demonstrated older `openExisting` failing after newer `openNew` still reports a stale shell error. Patch catches obsolete state-fetch/state-sync failures using presentation guards, while retaining current failures. Moves edit/create browser-import destination setup before the asynchronous open so old completions cannot select a different workspace. Six controller regression cases and two component cases were added but remain UNRUN. Actual-source reproduction after patch suppressed the stale failure; diff reviewed and whitespace checks passed. `workspace-open-repro.mjs` preserves the harness (local paths need adaptation).

Potential adjacent late `openTransfer` destination assignment was noticed but not changed or proven. Investigate separately rather than claiming this batch fixes every wrapper.

## Cadence and release state

- Completed cycles in this resumed run: 2 (prior clipboard verification and related-network-request fix/merge verification).
- Last issue/comment scan: 2026-09-30 ~01:58 UTC. Issues #229/#106/#3 are unchanged and depend on external distribution/UI/acceptance gates. PRs #291/#290 were read; no new comments/reviews.
- Next issue scan: after one further completed cycle or by 02:58 UTC; recheck at cloud startup because transfer may take time.
- Verified meaningful unreleased improvements: 21 since v2.8.4. Workspace batch and arrow work are unverified and not counted.
- Latest public release: https://github.com/hronaut/hronaut/releases/tag/v2.8.4, published 2026-09-29 21:21:03 UTC.
- Routine release earliest: 2026-09-30 03:21:03 UTC (six hours). No active release observed. Candidate 2.8.5 only after fresh source/tag/pipeline checks and required gates; never publish early, duplicate a release, overwrite tags or bypass failures.
- Use existing version-bump -> auto-tag -> release workflow, then verify assets and downstream publication checks. Nonbreaking patch/minor releases authorized in the original maintenance instruction; ask before breaking/major changes.

Full historical local saved progress: `/home/hronom/Dev/hronaut/.hronaut-maintenance/progress.md` (outside repo). This handoff contains the relevant current state for a cloud environment that cannot read that local path.

## Transfer

Fetch `origin/main`, `origin/handoff/video-arrow-design`, and `origin/fix/workspace-open-errors`. Read this handoff and preserve its evidence, then start arrow work on a fresh branch from verified main. Do not accidentally include `.maintenance-handoff` in the product PR. Keep the workspace-error commit separate until it is reviewed/tested and intentionally resumed.

No uncommitted product edits remained when this checkpoint branch was created. Local engineering is stopped; no further implementation, PR creation, merge or release will be performed locally.
