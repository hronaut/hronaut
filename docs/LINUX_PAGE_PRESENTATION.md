# Linux page presentation regression (2026-09-07)

## Observed failure

Hronaut 1.12.2 / Electron 44.2.0 / Chromium 152.0.7977.76 on Ubuntu
24.04.4, GNOME X11, with Intel graphics: the browser toolbar remained drawn
while its selected website was blank. The live window and its WebContentsView
were visible, attached, correctly sized and finished loading, but the website's
`document.visibilityState` was `hidden`.

Refreshing bounds, native view visibility and attachment did not recover the
inspected diagnostic tab. Refreshing its Electron embedder did: the same live
Example Domain document became visible and painted without navigation.

## Recovery and limits

`presented-view-visibility.ts` checks for the mismatch after layout, navigation
completion and screenshot presentation. It rechecks attachment, visibility,
loading and destruction before acting. Hidden/minimized hosts and detached
views are excluded. Checks are coalesced per view.

The workaround uses Electron's internal `setEmbedder` method, whose native
implementation calls `WasHidden` / `WasShown`. It is feature-checked and limited
to Linux / Electron 44. Reassess it when changing Electron major versions.
It preserves the document, focus and background-throttling setting.

The exact original agent command sequence that caused the live failure remains
unconfirmed. The regression deliberately induces the observed native mismatch
using Chromium's real freeze/thaw lifecycle, rather than mocking visibility.
It proves recovery from that state, not that freezing caused the reported bug.

## Reproduce and verify

The test starts an isolated application profile and attaches only to Electron's
Node inspector. A normal Playwright renderer attachment enables focus emulation,
which masks this visibility failure. The test also samples the displayed desktop
pixels after changing the page color, checks retained document state and focus,
and verifies that a deliberately hidden host remains hidden.

```bash
# Current Linux desktop, unchanged installed 1.12.2: fails (hidden != visible).
HRONAUT_TEST_EXECUTABLE=/opt/Hronaut/hronaut npm run test:integration:run -- tests/integration/linux-page-presentation.e2e.ts

# Current Linux desktop, rebuilt source with recovery: passes.
npm run build
npm run test:integration:run -- tests/integration/linux-page-presentation.e2e.ts

# Same real renderer regression under the pinned Linux/Xvfb environment.
npm run test:integration:docker:focused -- tests/integration/linux-page-presentation.e2e.ts
npm run test:integration:docker
```

## Upstream investigation

- [Electron 44.2.0 release](https://github.com/electron/electron/releases/tag/v44.2.0).
- [Electron #52809](https://github.com/electron/electron/issues/52809) reports
  blank content recovering on resize after background-throttling transitions.
  It is a related symptom on macOS / Electron 42, not a confirmed match for this
  Linux failure.
- [Electron 44.2.0 native WebContents implementation](https://github.com/electron/electron/blob/v44.2.0/shell/browser/api/electron_api_web_contents.cc)
  defines `SetEmbedder` and its native visibility refresh.
- [Chromium 152 lifecycle implementation](https://github.com/chromium/chromium/blob/152.0.7977.76/content/browser/devtools/protocol/page_handler.cc)
  calls `WasHidden` when freezing; activating only unfreezes the page.
