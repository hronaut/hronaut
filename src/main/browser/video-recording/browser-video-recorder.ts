import { basename } from 'node:path'
import { publishChange } from '../browser-state/browser-state.js'
import type { Browser } from '../browser.js'
import { writeUniqueDownloadFile } from '../unique-download-file.js'
import { readVideoAudioFile } from '../video-audio-file.js'
import { renderBrowserVideo } from '../video-export.js'
import { inspectVideoFrames } from '../video-inspection.js'
import { BrowserVideoRecorder } from '../video-recorder.js'

/** Records the browser's tabs to video, saving each recording as a new file in the download folder unless the caller chose another place. */
export function createVideoRecorder(browser: Browser): BrowserVideoRecorder {
  return new BrowserVideoRecorder({
    changed: () => publishChange(browser, false),
    render: renderBrowserVideo,
    inspect: inspectVideoFrames,
    loadAudio: readVideoAudioFile,
    save: async (data, validate, saveFile = (name, bytes, check) => writeUniqueDownloadFile(browser.options.downloadDirectory, name, bytes, check)) => {
      validate()
      const path = await saveFile(`hronaut-video-${Date.now()}.webm`, Buffer.from(data), validate)
      return path === undefined ? undefined : { filename: basename(path), path }
    }
  })
}
