import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { BrowserVideoRecorder } from '../src/main/browser/video-recorder.js'
import { readVideoAudioFile } from '../src/main/browser/video-audio-file.js'
import { LocalizedError } from '../src/main/localized-error.js'
import { localeMessages, translate } from '../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../src/shared/locale.js'
import { VIDEO_EDIT_ERRORS, validateVideoEdit, videoAnnotationSchema } from '../src/shared/video.js'

// The video recorder refused an action or an edit in English in every language, such as "Clear a retained recording
// first (maximum three)" or "Annotations must fit inside the recording".

// The English that browser_video has always reported; MCP results and code comparing messages keep reading it.
const ENGLISH = {
  busy: 'Wait for the current video operation to finish',
  previousRecording: 'Clear the previous recording before starting another',
  recordingCount: 'Clear a retained recording first (maximum three)',
  startFirst: 'Start a recording first',
  cancelled: 'Video operation was cancelled',
  stoppedCannotResume: 'Stopped recordings cannot resume; start a new recording after clearing',
  onlyPausedResume: 'Only a paused recording can resume',
  recordingLimit: 'Recording limit reached',
  stopBeforeImport: 'Stop recording before importing audio',
  audioAssetCount: 'Remove an imported audio asset first (maximum eight)',
  importedAudioTooLarge: 'Imported audio exceeds the 32 MiB recording limit',
  stopBeforeRemovingAudio: 'Stop recording before removing audio',
  audioAssetInUse: 'Remove this asset from the audio timeline first',
  stopBeforeEditing: 'Stop recording before editing',
  annotationsOutside: 'Annotations must fit inside the recording',
  clipsInvalid: 'Clips must be ordered, non-overlapping, and inside the recording',
  audioAssetUnavailable: 'Audio asset is unavailable in this recording',
  audioOutsideVideo: 'Audio events must fit inside the finished video',
  audioExceedsAsset: 'Audio event exceeds its asset; shorten it or enable looping',
  camerasInvalid: 'Camera moves must be ordered, non-overlapping and inside the recording',
  exportEmpty: 'Stop a non-empty recording before exporting',
  renderFirst: 'Render a preview first',
  returnToOrigin: 'Return to the recording origin to access this video, or discard it',
  tabUnavailable: 'Recording tab is unavailable',
  audioUnreadable: 'Audio file could not be read. Select a non-empty regular file no larger than 10 MiB.',
  exportTimeout: 'Video export cancelled or timed out'
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function recorder() {
  const host = { changed: vi.fn(), render: vi.fn(async () => new Uint8Array([1])), save: vi.fn(async () => ({ filename: 'video.webm', path: '/downloads/video.webm' })), now: () => Date.now() }
  const video = new BrowserVideoRecorder(host)
  const capture = vi.fn(async () => ({ data: new Uint8Array([4, 5, 6]), width: 640, height: 360 }))
  const manage = (tabId: string, options: Parameters<BrowserVideoRecorder['manage']>[1]) => video.manage(tabId, options, capture, vi.fn(), vi.fn())
  return { video, manage }
}

async function refusal(action: () => Promise<unknown>): Promise<LocalizedError> {
  const error = await action().then(() => undefined, (failure: unknown) => failure)
  expect(error).toBeInstanceOf(LocalizedError)
  return error as LocalizedError
}

it('refuses a fourth recording with a key Hronaut names in German and the English browser_video reports', async () => {
  const { video, manage } = recorder()
  for (const tabId of ['one', 'two', 'three']) await manage(tabId, { action: 'start' })
  const error = await refusal(() => manage('four', { action: 'start' }))
  expect(error.key).toBe('video.errors.recordingCount')
  expect(error.message).toBe(ENGLISH.recordingCount)
  expect(translate('de-DE', error.key)).toBe('Verwerfen Sie zuerst eine behaltene Aufnahme (höchstens drei)')
  video.destroy()
})

it('refuses an annotation outside the recording the same way, while the shared check keeps its plain English error', async () => {
  const { video, manage } = recorder()
  await manage('tab', { action: 'start' })
  await vi.advanceTimersByTimeAsync(1000)
  await manage('tab', { action: 'stop' })
  const annotations = [videoAnnotationSchema.parse({ kind: 'text', text: 'Late', startMs: 0, endMs: 60_000, x: 0.1, y: 0.1 })]
  const error = await refusal(() => manage('tab', { action: 'edit', annotations }))
  expect(error.key).toBe('video.errors.annotationsOutside')
  expect(error.message).toBe(ENGLISH.annotationsOutside)
  expect(() => validateVideoEdit(1000, [], [{ startMs: 0, endMs: 2000 }])).toThrow(new Error(VIDEO_EDIT_ERRORS.clipsInvalid))
  video.destroy()
})

it('refuses an unreadable audio file without naming its path', async () => {
  vi.useRealTimers()
  const error = await refusal(() => readVideoAudioFile('relative/secret-name.wav', () => undefined))
  expect(error.key).toBe('video.errors.audioUnreadable')
  expect(error.message).toBe(ENGLISH.audioUnreadable)
  expect(error.message).not.toContain('secret-name')
})

it('keeps the English refusals and has every refusal in every language', () => {
  expect(localeMessages['en-US'].video.errors).toEqual(ENGLISH)
  expect(VIDEO_EDIT_ERRORS).toEqual({ annotationsOutside: ENGLISH.annotationsOutside, clipsInvalid: ENGLISH.clipsInvalid })
  for (const locale of SUPPORTED_LOCALES) expect(Object.keys(localeMessages[locale].video.errors)).toEqual(Object.keys(ENGLISH))
})
