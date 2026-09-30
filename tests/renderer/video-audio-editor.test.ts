import { cleanup, fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, expect, it, vi } from 'vitest'
import VideoAudioEditor from '../../src/renderer/src/components/VideoAudioEditor.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import { VIDEO_AUDIO_BUILTINS, VIDEO_AUDIO_LIMITS } from '../../src/shared/video-audio.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../../src/shared/video.js'

const state = (): BrowserVideoState => ({ tabId: 'tab', status: 'stopped', durationMs: 2000, width: 640, height: 360, frameCount: 12, bytes: 500, annotations: [], clips: [], previewReady: false, audioAssets: VIDEO_AUDIO_BUILTINS.map(asset => ({ ...asset })) })
afterEach(cleanup)

it('blocks adding beyond cue capacity while preserving edits and removal', async () => {
  const current = state()
  current.audio = Array.from({ length: VIDEO_AUDIO_LIMITS.events }, () => ({ assetId: 'builtin:ambient', startMs: 0, endMs: 1000, offsetMs: 0, volume: 0.25, fadeInMs: 0, fadeOutMs: 0, loop: false }))
  const onEdit = vi.fn<(options: Partial<BrowserVideoOptions>) => void>()
  const view = render(VideoAudioEditor, { props: { state: current, busy: false, onEdit }, global: { plugins: [createHronautI18n('en-US')] } })
  await fireEvent.click(screen.getByText(/Music and sound/))

  expect(screen.getByRole('button', { name: 'Add audio event' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Edit audio event 1' }))
  await fireEvent.update(screen.getByLabelText('Volume (%)'), '42')
  await fireEvent.click(screen.getByRole('button', { name: 'Save audio event' }))
  expect(onEdit.mock.lastCall?.[0].audio).toHaveLength(VIDEO_AUDIO_LIMITS.events)
  expect(onEdit.mock.lastCall?.[0].audio?.[0]?.volume).toBe(0.42)

  await fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Remove audio event 1' }))
  const audio = onEdit.mock.lastCall?.[0].audio
  expect(audio).toHaveLength(VIDEO_AUDIO_LIMITS.events - 1)
  await view.rerender({ state: { ...current, audio } })
  expect(screen.getByRole('button', { name: 'Add audio event' })).toBeEnabled()
})

it('avoids opening import at asset capacity and enables it after an unused asset is removed', async () => {
  const current = state()
  const imports = Array.from({ length: VIDEO_AUDIO_LIMITS.assets }, (_, index) => ({ id: `import-${index}`, name: `Original ${index}`, durationMs: 1000, provenance: 'Original synthesis', builtin: false }))
  current.audioAssets!.push(...imports)
  const onImport = vi.fn(), onRemoveAsset = vi.fn()
  const view = render(VideoAudioEditor, { props: { state: current, busy: false, onImport, onRemoveAsset }, global: { plugins: [createHronautI18n('en-US')] } })
  await fireEvent.click(screen.getByText(/Music and sound/))
  await fireEvent.update(screen.getByLabelText('Audio source and usage rights'), 'Original synthesis')

  expect(screen.getByRole('button', { name: 'Choose WAV audio…' })).toBeDisabled()
  await fireEvent.click(screen.getByRole('button', { name: 'Choose WAV audio…' }))
  expect(onImport).not.toHaveBeenCalled()
  await fireEvent.update(screen.getByLabelText('Audio asset'), 'import-0')
  await fireEvent.click(screen.getByRole('button', { name: 'Remove selected imported asset' }))
  expect(onRemoveAsset).toHaveBeenCalledWith('import-0')
  await view.rerender({ state: { ...current, audioAssets: current.audioAssets!.filter(asset => asset.id !== 'import-0') } })
  expect(screen.getByRole('button', { name: 'Choose WAV audio…' })).toBeEnabled()
})
