import type { BrowserVideoInspectionOptions } from '../../../shared/video-inspection.js'
import { VIDEO_LIMITS, type BrowserVideoOptions, type BrowserVideoState } from '../../../shared/video.js'
import { captureStableVideoImage } from '../video-capture.js'
import { LocalizedError } from '../../localized-error.js'
import type { PendingVideoInspection, VideoSourceBinding } from '../video-recorder.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'
import { withRenderableTab } from '../renderable-tab/renderable-tab.js'

/**
 * Runs the action on the tab's video recording, from starting and stopping
 * it to editing and exporting it. Frames are captured only while Hronaut is
 * visible and the tab stays awake, active and at the origin it started on, in
 * its workspace, at its first viewport size; the recording is reachable only
 * from that origin.
 */
export async function videoRecording(browser: Browser, options: BrowserVideoOptions, validateAuthority: () => void = () => undefined, signal?: AbortSignal): Promise<BrowserVideoState> {
  const tab = getTab(browser, options.tabId)
  const origin = new URL(tab.url).origin
  const workspaceId = tab.mcpGroupId
  const valid = (): void => {
    validateAuthority()
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new LocalizedError('video.errors.tabUnavailable')
  }
  let initialSize: { width: number; height: number } | undefined
  const capture = async () => {
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new LocalizedError('video.errors.tabUnavailable')
    if (!/^https?:/.test(tab.url) || new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active' || !browser.window.isVisible() || browser.window.isMinimized() || browser.browserContentOccluded) throw new Error('Keep Hronaut visible and the recording tab awake at its original origin')
    const image = await captureStableVideoImage(
      () => withRenderableTab(browser, tab, () => tab.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })),
      () => tab.navigationGeneration,
      () => tab.webContents.isLoadingMainFrame()
    )
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new LocalizedError('video.errors.tabUnavailable')
    if (new URL(tab.url).origin !== origin || tab.sleeping || tab.pageLifecycleState !== 'active' || !browser.window.isVisible() || browser.window.isMinimized() || browser.browserContentOccluded) throw new Error('The tab changed during capture')
    if (!image) return null
    const size = image.getSize()
    if (initialSize && (size.width !== initialSize.width || size.height !== initialSize.height)) throw new Error('Restore the original viewport size before resuming')
    initialSize = size
    const scale = Math.min(1, VIDEO_LIMITS.width / size.width, VIDEO_LIMITS.height / size.height)
    const width = Math.max(2, Math.floor(size.width * scale / 2) * 2)
    const height = Math.max(2, Math.floor(size.height * scale / 2) * 2)
    return { data: image.resize({ width, height }).toJPEG(85), width, height }
  }
  const validateSource = (): void => {
    if (findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || new URL(tab.url).origin !== origin) throw new LocalizedError('video.errors.returnToOrigin')
  }
  return browser.videoRecorder.manage(tab.id, options, capture, valid, validateSource, signal, { tabId: tab.id, workspaceId, origin })
}

/** Prepares frames of the tab's recording for inspection while its tab and workspace stay the recording's own. */
export async function inspectVideo(browser: Browser, options: BrowserVideoInspectionOptions, authorize: (source: VideoSourceBinding) => void, signal?: AbortSignal): Promise<PendingVideoInspection> {
  const tab = getTab(browser, options.tabId)
  return browser.videoRecorder.inspect(tab.id, options, source => {
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.webContents.isDestroyed()
      || tab.id !== source.tabId || tab.mcpGroupId !== source.workspaceId) throw new Error('Recording tab or workspace is unavailable')
    authorize(source)
  }, signal)
}

/** The tab's latest recorded frame. */
export function videoPreview(browser: Browser, tabId: string): Uint8Array {
  return browser.videoRecorder.preview(getTab(browser, tabId).id)
}
