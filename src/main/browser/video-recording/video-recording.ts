import type { BrowserVideoInspectionOptions } from '../../../shared/video-inspection.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../../../shared/video.js'
import { videoCaptureSource } from './video-capture-source.js'
import { LocalizedError } from '../../localized-error.js'
import type { PendingVideoInspection, VideoSourceBinding } from '../video-recorder.js'
import type { ExportFileWriter } from '../unique-download-file.js'
import type { Browser } from '../browser.js'
import { findTab, getTab } from '../browser-core.js'

/**
 * Runs the action on the tab's video recording, from starting and stopping
 * it to editing and exporting it. Frames are captured only while Hronaut is
 * visible and the tab stays awake, active and at the origin it started on, in
 * its workspace, at its first viewport size; the recording is reachable only
 * from that origin. An export is saved through saveFile when the caller chose one, else in the download folder.
 */
export async function videoRecording(
  browser: Browser,
  options: BrowserVideoOptions,
  validateAuthority: () => void = () => undefined,
  signal?: AbortSignal,
  saveFile?: ExportFileWriter
): Promise<BrowserVideoState> {
  const tab = getTab(browser, options.tabId)
  const origin = new URL(tab.url).origin
  const workspaceId = tab.mcpGroupId
  const valid = (): void => {
    validateAuthority()
    if (browser.destroyed || findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || tab.webContents.isDestroyed()) throw new LocalizedError('video.errors.tabUnavailable')
  }
  const capture = videoCaptureSource(browser, tab, origin, workspaceId, valid)
  const validateSource = (): void => {
    if (findTab(browser, tab.id) !== tab || tab.mcpGroupId !== workspaceId || new URL(tab.url).origin !== origin) throw new LocalizedError('video.errors.returnToOrigin')
  }
  return browser.videoRecorder.manage(tab.id, options, capture, valid, validateSource, signal, { tabId: tab.id, workspaceId, origin }, saveFile)
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

/** The tab's rendered recording, for the shell to play; it throws until the recording is rendered. */
export function videoPreview(browser: Browser, tabId: string): Uint8Array {
  return browser.videoRecorder.preview(getTab(browser, tabId).id)
}
