import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import VideoRecorder from '../../src/renderer/src/components/VideoRecorder.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { localeMessages } from '../../src/shared/i18n.js'
import { VIDEO_SCHEMA_ERRORS, type BrowserVideoState } from '../../src/shared/video.js'

// An annotation or kept range that ended before it started showed Zod's raw issue list, such as
// [{"code":"custom","path":[],"message":"Annotation end must follow its start"}], in English in every language.

const de = localeMessages['de-DE'].video
const stopped: BrowserVideoState = { tabId: 'tab', status: 'stopped', durationMs: 2000, width: 640, height: 360, frameCount: 12, bytes: 500, annotations: [], clips: [], previewReady: false, recordingId: 'recording-tab', timing: { clock: 'recording-monotonic', observedAtMs: 2000, sourceTimeMs: 2000, revision: 1, pixelTime: 'unknown' } }
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function showRecorder() {
  const manageVideo = vi.fn(async () => stopped)
  vi.stubGlobal('hronaut', { manageVideo })
  render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('de-DE')] } })
  await flushPromises()
  return manageVideo
}
const edits = (manageVideo: ReturnType<typeof vi.fn>) => manageVideo.mock.calls.filter(([options]) => (options as { action: string }).action === 'edit')

it('says in German that an annotation must end after it starts, without the raw issue list', async () => {
  const manageVideo = await showRecorder()
  await fireEvent.update(screen.getByLabelText(de.caption), 'Klicken Sie auf Veröffentlichen')
  await fireEvent.update(screen.getAllByLabelText(de.from)[0], '1.5')
  await fireEvent.update(screen.getAllByLabelText(de.to)[0], '1')
  await fireEvent.click(screen.getByRole('button', { name: de.addAnnotation }))
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent(de.errors.annotationEnd)
  expect(screen.getByRole('alert').textContent).not.toContain(VIDEO_SCHEMA_ERRORS.annotationEnd)
  expect(screen.getByRole('alert').textContent).not.toContain('"code"')
  expect(edits(manageVideo)).toHaveLength(0)
})

it('says the same for a kept range sent through the edit action', async () => {
  const manageVideo = await showRecorder()
  await fireEvent.update(screen.getAllByLabelText(de.from)[1], '1')
  await fireEvent.update(screen.getAllByLabelText(de.to)[1], '0.5')
  await fireEvent.click(screen.getByRole('button', { name: de.addClip }))
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent(de.errors.clipEnd)
  expect(edits(manageVideo)).toHaveLength(0)
})

it('asks to check the values when the refusal has no named reason', async () => {
  const manageVideo = await showRecorder()
  await fireEvent.update(screen.getByLabelText(de.caption), 'Breit')
  await fireEvent.update(screen.getByLabelText(de.width), '200')
  await fireEvent.click(screen.getByRole('button', { name: de.addAnnotation }))
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent(de.errors.invalidEdit)
  expect(screen.getByRole('alert').textContent).not.toContain('"code"')
  expect(edits(manageVideo)).toHaveLength(0)
})

it('says the same for a camera move from its own editor', async () => {
  const manageVideo = await showRecorder()
  await fireEvent.click(screen.getByText(de.motion.title))
  await fireEvent.update(screen.getByLabelText(de.motion.from), '1')
  await fireEvent.update(screen.getByLabelText(de.motion.to), '0.5')
  await fireEvent.click(screen.getByRole('button', { name: de.motion.add }))
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent(de.errors.cameraEnd)
  expect(edits(manageVideo)).toHaveLength(0)
})
