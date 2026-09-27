import { render, screen, fireEvent, cleanup } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import VideoRecorder from '../../src/renderer/src/components/VideoRecorder.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../../src/shared/video.js'

const state = (tabId: string, status: BrowserVideoState['status'] = 'stopped'): BrowserVideoState => ({ tabId, status, durationMs: 2000, width: 640, height: 360, frameCount: 12, bytes: 500, annotations: [], clips: [], previewReady: false })
afterEach(() => { cleanup(); vi.restoreAllMocks() })
it('ignores a stale render result after switching tabs and does not fetch the old preview', async () => {
  let finish!: (result: BrowserVideoState) => void
  const manageVideo = vi.fn(({ tabId, action }: { tabId: string; action: string }) => action === 'render' ? new Promise<BrowserVideoState>(resolve => { finish = resolve }) : Promise.resolve(state(tabId)))
  const videoPreview = vi.fn()
  Object.assign(window, { hronaut: { manageVideo, videoPreview } })
  const view = render(VideoRecorder, { props: { tabId: 'first' }, global: { plugins: [createHronautI18n('en-US')] } })
  await flushPromises()
  await fireEvent.click(screen.getByRole('button', { name: 'Preview video' }))
  await view.rerender({ tabId: 'second' })
  await flushPromises()
  finish({ ...state('first'), previewReady: true })
  await flushPromises()
  expect(videoPreview).not.toHaveBeenCalled()
  expect(view.container.querySelector('video')).toBeNull()
  expect(screen.getByRole('button', { name: 'Preview video' })).toBeEnabled()
})
it('sends normalized annotation coordinates and retains the original recording on invalid edits', async () => {
  const manageVideo = vi.fn().mockResolvedValue(state('tab'))
  Object.assign(window, { hronaut: { manageVideo } })
  render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('en-US')] } })
  await flushPromises()
  await fireEvent.update(screen.getByLabelText('Caption text'), 'Click Publish')
  await fireEvent.update(screen.getByLabelText('Caption position'), 'custom')
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  expect(manageVideo).toHaveBeenCalledWith(expect.objectContaining({ action: 'edit', annotations: [expect.objectContaining({ text: 'Click Publish', x: 0.1, y: 0.1, startMs: 0, endMs: 1000 })] }))
  manageVideo.mockRejectedValueOnce(new Error('Annotations must fit inside the recording'))
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  expect(screen.getByRole('alert')).toHaveTextContent('Annotations must fit inside the recording')
  expect(screen.getByRole('button', { name: 'Export WebM' })).toBeEnabled()
})


it('sends cloneable data when adding a second annotation from Vue reactive state', async () => {
  const current = state('tab')
  const manageVideo = vi.fn(async (options: BrowserVideoOptions) => {
    const input = structuredClone(options)
    if (input.action === 'edit') current.annotations = input.annotations as BrowserVideoState['annotations']
    return structuredClone(current)
  })
  Object.assign(window, { hronaut: { manageVideo } })
  render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('en-US')] } })
  await flushPromises()
  await fireEvent.update(screen.getByLabelText('Caption text'), 'Step one')
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  await fireEvent.update(screen.getByLabelText('Annotation type'), 'arrow')
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  expect(current.annotations).toHaveLength(2)
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('exposes caption anchors and callout styling through the same cloneable agent contract', async () => {
  const manageVideo = vi.fn<(options: BrowserVideoOptions) => Promise<BrowserVideoState>>().mockResolvedValue(state('tab'))
  Object.assign(window, { hronaut: { manageVideo } })
  render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('en-US')] } })
  await flushPromises()
  await fireEvent.update(screen.getByLabelText('Caption text'), 'Your project is ready')
  await fireEvent.update(screen.getByLabelText('Caption position'), 'top-right')
  await fireEvent.update(screen.getByLabelText('Maximum width (%)'), '42')
  await fireEvent.update(screen.getByLabelText('Text alignment'), 'right')
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  const caption = manageVideo.mock.calls.find(([options]) => options.action === 'edit')?.[0].annotations?.[0]
  expect(caption).toMatchObject({ placement: 'top-right', width: 0.42, align: 'right', theme: 'dark', animation: 'fade' })
  expect(caption?.x).toBeUndefined()
  await fireEvent.update(screen.getByLabelText('Annotation type'), 'callout')
  await fireEvent.update(screen.getByLabelText('Card heading (optional)'), 'Invite a teammate')
  await fireEvent.update(screen.getByLabelText('Step number (optional)'), '2')
  await fireEvent.click(screen.getByRole('button', { name: 'Add annotation' }))
  await flushPromises()
  expect(manageVideo).toHaveBeenLastCalledWith({ tabId: 'tab', action: 'get' })
  expect(manageVideo.mock.calls.filter(([options]) => options.action === 'edit').at(-1)?.[0].annotations?.[0]).toMatchObject({ kind: 'callout', placement: 'auto', title: 'Invite a teammate', step: 2, endX: 0.5, endY: 0.5 })
})
