# Page freeze and resume

Hronaut can hold one live tab at a deterministic review boundary without
selecting, sleeping, discarding, or reloading it. Use the **Live / Frozen**
control beside the page-input lock, the tab context menu, or the
`browser_page_lifecycle` MCP tool.

This is a QA aid, not a security boundary, transaction snapshot, or complete
browser-process freeze. The tab keeps its URL, profile, storage, navigation
history, renderer, and visible document. Selecting another tab, switching
workspaces, pausing or reconnecting MCP, taking a capture, or unrelated tab
activity does not resume it. Resume is explicit.

## Verified runtime contract

The integration fixture runs without Playwright attached to Chromium, because
Playwright's focus emulation changes page visibility. On Electron 44.3.0 with
Chromium 152.0.7977.78 it verifies:

| Clock or state | While frozen | After resume |
| --- | --- | --- |
| Main-document `setInterval` | Stops | Continues |
| Main-document `requestAnimationFrame` | Stops | Continues |
| Main-document CSS Animations | Paused by Hronaut | Prior running/paused state continues |
| Main-document Web Animations | Paused by Hronaut | Prior running/paused state continues |
| Configured animation playback rate | Preserved, including rates other than `1` | The actual prior rate remains configured |
| Another tab | Not frozen; its normal Chromium background throttling still applies | Unchanged |
| Selection, workspace, MCP pause, input lock, Memory Saver | Unchanged | Unchanged |

Dedicated workers are measured by the fixture but are not part of the freeze
guarantee. Media, network-delivered updates, service workers, GPU work,
operating-system clocks, and cross-origin frames may continue or queue work.
Review their state after resume when they matter to a test.

## Lifecycle and uncertain outcomes

- Repeating the same completed freeze or resume is idempotent. Concurrent
  identical requests share one operation.
- A main-frame navigation or reload creates a fresh `active` document and does
  not replay the previous hold.
- Closing the tab removes the state. Renderer loss or debugger detachment while
  frozen changes the observable state to `unknown`.
- Restart never persists a hold; restored tabs start as `active` documents.
- If a dispatched protocol command times out or loses its connection, Hronaut
  reports `unknown` and does not retry, roll back, or claim success. Explicitly
  request the opposite state, or navigate/reload to establish a fresh active
  document.
- Frozen and unknown tabs are ineligible for Memory Saver so a live review
  boundary cannot be silently replaced by a reload.

