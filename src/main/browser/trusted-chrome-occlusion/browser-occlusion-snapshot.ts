import { screen } from 'electron'
import type { Browser } from '../browser.js'
import { OCCLUSION_SNAPSHOT_TIMEOUT_MS, OcclusionSnapshot } from '../occlusion-snapshot.js'
import { occlusionLayout, occlusionSnapshotPanes } from './trusted-chrome-occlusion.js'

/** Integration tests on a loaded machine can give the snapshot more time, so its ordering check is not a race. */
function occlusionSnapshotTimeoutMs(): number {
  const override = Number(process.env.HRONAUT_TEST_OCCLUSION_SNAPSHOT_TIMEOUT_MS)
  return process.env.HRONAUT_INTEGRATION_TEST_HOOKS === '1' && Number.isSafeInteger(override) && override > 0
    ? override
    : OCCLUSION_SNAPSHOT_TIMEOUT_MS
}

/** Keeps the window's pages on screen while trusted chrome opens over them, until the shell shows a still image of them. */
export function createOcclusionSnapshot(browser: Browser): OcclusionSnapshot {
  return new OcclusionSnapshot({
    panes: () => occlusionSnapshotPanes(browser),
    layout: () => occlusionLayout(browser),
    cssScale: () => browser.window.webContents.getZoomFactor?.() ?? 1,
    deviceScale: () => screen.getDisplayMatching(browser.window.getBounds()).scaleFactor,
    send: (snapshot) => {
      if (!browser.window.isDestroyed() && !browser.window.webContents.isDestroyed()) browser.window.webContents.send('browser:occlusion-snapshot', snapshot)
    },
    relayout: () => browser.layout(),
    pagesHidden: (request) => {
      if (!browser.window.isDestroyed() && !browser.window.webContents.isDestroyed()) browser.window.webContents.send('browser:occlusion-pages-hidden', request)
    },
    timeoutMs: occlusionSnapshotTimeoutMs()
  })
}
