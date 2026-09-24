# Explicit recorder assertions

Status: implementation proposal, reviewed September 24, 2026 against `a342a10`.
This feature is not implemented or included in a release.

## Intended behavior

While recording, the user chooses **Expect element visible**, selects a page
element, and sees an assertion added to the timeline. Canceling leaves the
recording unchanged. Selection expresses the user's expected outcome; recording
it is not proof that a generated test passes. Export emits an awaited Playwright
visibility assertion at that point in the timeline. Action-only exports keep
the existing deliberate TODO failure until the user supplies an expected result.

[Playwright's generator](https://playwright.dev/docs/codegen) offers explicit
visibility, text, and value assertions. Start with visibility so the expectation
can be recorded without collecting a new class of page content. Playwright's
[assertion API](https://playwright.dev/docs/test-assertions) supplies the retrying
`await expect(locator).toBeVisible()` export form.

Chrome's [Recorder reference](https://developer.chrome.com/docs/devtools/recorder/reference#add-assertions)
also documents explicit `waitForElement` assertions, including visibility, plus
manual hover steps for menus that cannot be reached by a click alone. This
supports prioritizing an explicit visibility expectation first; an editable hover
step is a separate follow-up candidate, not a reason to record every pointer move.

The current Hronaut recorder now validates selector uniqueness within a
500-character bound and preserves unresolved targets as manual export steps.
Assertion selection must reject unresolved targets rather than count them as
exportable expectations. This groundwork does not implement assertion capture.
Existing recorder capture now keeps detected iframe/frame and open-shadow targets as manual steps. This does not add cross-root replay or closed-shadow detection.
Exported locators must retain the same light-DOM scope used to validate captured
selectors. A unique document button can become ambiguous if plain Playwright CSS
also matches buttons inside unrelated open shadow roots.

## Integration boundaries

- `src/main/browser/repro-recorder.ts` owns assertion insertion and recording
  identity, limits, and ordering. Keep the pending selection tied to the original
  recording object, tab identity, WebContents, navigation generation, and
  workspace observation generation. Recheck all of them before inserting a step.
- `BrowserTabsManager` owns native selection and workspace access. Reuse selection
  lifecycle and cancellation machinery with a recorder-specific result mode.
  The existing `browser:pick-element` IPC handler copies rich inspection data to
  the clipboard; invoking that command would give assertion selection unwanted
  side effects. Do not route the feature through it.
- Both native pointer selection and the page picker need the same bounded
  structural-selector algorithm. The inspection picker currently prefers IDs,
  test attributes, and classes; `reproTargetScript` in `repro-page-scripts.ts` uses structural positions.
  Share structural selector generation without changing ordinary inspection
  behavior. Do not include text, values, attributes, or clipboard content in the
  assertion result. Validate that the selector uniquely identifies the selected
  node; reject truncation or ambiguity instead of recording another element.
- Add an explicit typed assertion request/result through shared contracts,
  diagnostic IPC, preload, and renderer store. A canceled result is distinct from
  success or failure. Main-process recording identity remains authoritative.
- `useDiagnosticsController` tracks selection as a mutation, so automatic refresh
  cannot replace its busy or error state. `DiagnosticsPanels.vue` exposes the
  action and cancellation state; `ReproTimeline.vue` presents the selected
  expectation. Add translations in all supported locales and keyboard coverage.
- `repro-export.ts` imports `expect` when needed and emits assertions using the
  existing JavaScript literal escaping. Remove the final assertion TODO only
  when a supported, exportable explicit assertion exists. Preserve warnings for
  active or truncated recordings and incomplete or redacted actions.
  Unexportable manual steps must still stop execution explicitly: adding a later
  assertion that is already true must not turn an incomplete timeline into a
  passing test merely because the final assertion TODO was removed.

## Selection and ordering rules

Selection must consume the picker click without appending a normal click step.
Flush earlier queued input before insertion. Stop, clear, restart, navigation,
tab closure, workspace control changes, and picker replacement cancel or reject
an outstanding assertion; they must not hang while waiting for a user selection.
A late result cannot append to a replacement or stopped recording.

The initial contract targets top-level light-DOM elements. Detect selections
that require frame or shadow-root traversal and return a useful unsupported
message; never silently substitute a containing iframe or host. Frame-aware
assertions need an explicit locator-path contract before support is advertised.
Do not accept a detached node or ambiguous selector. Visibility expectation is
user intent; any capture-time visibility check must not be advertised as an
executed Playwright assertion.

## Verification before delivery

1. Unit tests cover assertion export, escaping, missing/invalid targets, mixed
   action/assertion timelines, TODO retention, recording limits, and detached
   snapshots. Test uniqueness and bounded selectors on repeated/deep structures.
   Include a light-DOM target beside unrelated shadow-root matches, and an
   unresolved action followed by an assertion that passes without that action.
2. Controller/component tests cover cancel, busy/error retention during refresh,
   keyboard operation, and timeline selection after restart.
3. Docker Electron cases cover actual native selection and the page picker,
   absence of a duplicate click, unchanged clipboard, and each cancellation race
   listed above. Include iframe/shadow selections, removed/hidden elements, and
   changed workspace control.
4. Run an exported synthetic fixture through Playwright: its selected expectation
   passes initially and fails after the fixture violates it. This proves the
   exported assertion executes; inspecting its string alone does not.
5. Run full static checks and immutable Docker/native-dialog gates. Publish only
   after release validation passes. Text/value assertions and in-app replay
   remain separate product and privacy decisions.
