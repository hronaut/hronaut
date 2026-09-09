# Linux agent capture focus regression

A native Wayland test reproduced transient foreground focus loss while an agent
captured an inactive tab. The screenshot succeeded and the previous window could
regain focus before the tool returned. Checking only the final focused window
therefore missed the interruption.

The temporary capture host used `showInactive()` with `focusable: false`.
Electron documents `showInactive()` as unsupported on Wayland. The revised path
attaches the background tab outside the viewport of the existing host when it
is visible and not minimized. This uses its compositor without mapping another
native window or changing tab selection. Local child-view bounds keep the capture
clear of the toolbar and visible pages; window-manager positioning is not needed.

Hidden/minimized hosts still use the existing temporary capture host. Focus
preservation for that path on Wayland is not established by this fix. Keeping
that host hidden failed to produce a renderable surface in the tested runtime;
removing it unconditionally would break tray screenshots.

## Regression coverage

`tests/integration/agent-window-focus.e2e.ts` counts foreground blur events,
checks that visible-host capture creates no extra native window, checks real
image pixels, and verifies retained unsaved form state and scroll position.
It also covers delayed page focus, delayed navigation, and `browser_show`.
`tests/integration/screenshot-tray.e2e.ts` covers hidden captures and tab lifecycle
races. `tests/integration/tab-overview-page-preview.e2e.ts` additionally checks
that the capture view is outside the visible viewport and detaches at its response
deadline. Run these with the standard focused Docker runner.

For native Wayland coverage, run the same cases inside the Docker test
container with Weston, Xvfb and xdotool available. Start Xvfb with a 1920x1080
screen, then Weston using its X11 backend, a private `XDG_RUNTIME_DIR`, and a
private Wayland socket. Set `DISPLAY` to that Xvfb display and
`WAYLAND_DISPLAY` to that socket. Do not connect the test to the user's desktop.

```bash
# Inside the prepared isolated compositor environment:
HRONAUT_TEST_WAYLAND=1 XDG_SESSION_TYPE=wayland \
  npx playwright test tests/integration/agent-window-focus.e2e.ts \
  tests/integration/screenshot-tray.e2e.ts --retries=0
```

The opt-in fixture selects Electron's native Wayland backend. The test briefly
uses a fullscreen fixture window and a native center click to establish actual
keyboard focus, then restores a normal window before performing agent actions.
A renderer-only focus simulation cannot establish this precondition.

Sources: [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)
and [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view).
