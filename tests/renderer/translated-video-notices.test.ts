import { cleanup, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import VideoRecorder from '../../src/renderer/src/components/VideoRecorder.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../../src/shared/locale.js'
import { VIDEO_RECORDING_NOTICES, type BrowserVideoState } from '../../src/shared/video.js'

// The recorder said why capture paused or stopped in English in every language, and told the person to "resume
// explicitly", words meant for agents.

const paused = (notice: string): BrowserVideoState => ({ tabId: 'tab', status: 'paused', durationMs: 2000, width: 640, height: 360, frameCount: 12, bytes: 500, annotations: [], clips: [], previewReady: false, notice, recordingId: 'recording-tab', timing: { clock: 'recording-monotonic', observedAtMs: 2000, sourceTimeMs: 2000, revision: 1, pixelTime: 'unknown' } })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function showNotice(notice: string, locale: 'de-DE' | 'en-US' = 'de-DE'): Promise<void> {
  vi.stubGlobal('hronaut', { manageVideo: vi.fn(async () => paused(notice)) })
  render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n(locale)] } })
  await flushPromises()
}

it('says in German that capture paused for system sleep', async () => {
  await showNotice(VIDEO_RECORDING_NOTICES.sleep)
  expect(screen.getByText('Aufnahme pausiert, während der Computer im Ruhezustand war. Setzen Sie das Video fort, um weiterzumachen.')).toBeInTheDocument()
  expect(screen.queryByText(VIDEO_RECORDING_NOTICES.sleep)).toBeNull()
})

it('names the capture conditions in English for a person, without "resume explicitly"', async () => {
  await showNotice(VIDEO_RECORDING_NOTICES.gap, 'en-US')
  expect(screen.getByText('Capture paused after a gap without frames. Resume the video to continue.')).toBeInTheDocument()
})

it('shows a notice it does not know as it came', async () => {
  await showNotice('Recording paused by the agent')
  expect(screen.getByText('Recording paused by the agent')).toBeInTheDocument()
})

it('has every notice in every language', () => {
  for (const locale of SUPPORTED_LOCALES) {
    expect(Object.keys(localeMessages[locale].video.notices)).toEqual(Object.keys(VIDEO_RECORDING_NOTICES))
  }
})
