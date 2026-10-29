import { cleanup, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import VideoRecorder from '../../src/renderer/src/features/video/VideoRecorder.vue'
import { createHronautI18n } from '../../src/renderer/src/i18n.js'
import type { BrowserVideoOptions, BrowserVideoState } from '../../src/shared/video.js'

const state = (status: BrowserVideoState['status']): BrowserVideoState => ({
  tabId: 'tab', status, durationMs: 2000, width: 640, height: 360, frameCount: 12, bytes: 500, annotations: [], clips: [],
  previewReady: false,
  ...(status === 'idle' ? {} : {
    recordingId: 'recording-tab',
    timing: { clock: 'recording-monotonic' as const, observedAtMs: 2000, sourceTimeMs: 2000, revision: 1, pixelTime: 'unknown' as const }
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

// JSDOM keeps focus on a control that becomes disabled, itself or through its fieldset; Chromium moves it to the body.
function emulateChromiumFocusFixup(): MutationObserver {
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const owner = record.target as HTMLElement
      const active = document.activeElement
      if (!(active instanceof HTMLElement) || active === document.body || !owner.hasAttribute('disabled') || !owner.contains(active)) continue
      owner.removeAttribute('disabled')
      active.blur()
      owner.setAttribute('disabled', '')
    }
  })
  observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] })
  return observer
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderRecorder(initial: BrowserVideoState, pending: Promise<BrowserVideoState>) {
  let current = initial
  const manageVideo = vi.fn((options: BrowserVideoOptions) => {
    if (options.action === 'get') return Promise.resolve(current)
    return pending.then((next) => { current = next; return next })
  })
  vi.stubGlobal('hronaut', { manageVideo })
  return render(VideoRecorder, { props: { tabId: 'tab' }, global: { plugins: [createHronautI18n('en-US')] } })
}

describe('VideoRecorder focus after an action', () => {
  // Every recorder control is disabled while Hronaut answers, so Chromium moved the focus of the one you used to the
  // document body: the next Tab started at the top of the window.
  it('gives the focus back to Add annotation once the annotation is saved', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const saved = deferred<BrowserVideoState>()
    const view = renderRecorder(state('stopped'), saved.promise)
    const observer = emulateChromiumFocusFixup()
    try {
      const add = await screen.findByRole('button', { name: 'Add annotation' })
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Caption text'), 'Click Publish')
      await user.click(add)
      await vi.waitFor(() => expect(add).toBeDisabled())
      expect(document.body).toHaveFocus()
      saved.resolve(state('stopped'))
      await vi.waitFor(() => expect(add).toBeEnabled())
      await vi.waitFor(() => expect(add).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  // Start gives way to Pause and Stop once recording begins. Not to them: a held Enter would pause or stop at once.
  it('keeps the focus in the recorder once Start gives way to Pause and Stop', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const started = deferred<BrowserVideoState>()
    const view = renderRecorder(state('idle'), started.promise)
    const observer = emulateChromiumFocusFixup()
    try {
      const start = await screen.findByRole('button', { name: 'Start video recording' })
      await userEvent.setup().click(start)
      await vi.waitFor(() => expect(start).toBeDisabled())
      expect(document.body).toHaveFocus()
      started.resolve(state('recording'))
      await screen.findByRole('button', { name: 'Pause video' })
      const recorder = screen.getByRole('region', { name: 'Video recorder' })
      await vi.waitFor(() => expect(recorder).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  // Annotation rows are keyed by position, so once the first is removed its Remove button stands for the second. Giving
  // it the focus back let a held Enter remove every annotation after the one you meant.
  it('keeps the focus off the Remove button that now stands for the next annotation', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const annotation = (text: string) => ({ kind: 'text' as const, startMs: 0, endMs: 1000, text, color: '#7c3aed' })
    const removed = deferred<BrowserVideoState>()
    const view = renderRecorder({ ...state('stopped'), annotations: [annotation('One'), annotation('Two'), annotation('Three')] }, removed.promise)
    const observer = emulateChromiumFocusFixup()
    try {
      const remove = await screen.findByRole('button', { name: 'Remove annotation 1' })
      await userEvent.setup().click(remove)
      await vi.waitFor(() => expect(remove).toBeDisabled())
      removed.resolve({ ...state('stopped'), annotations: [annotation('Two'), annotation('Three')] })
      await vi.waitFor(() => expect(remove).toBeEnabled())
      expect(remove.isConnected).toBe(true)
      const recorder = screen.getByRole('region', { name: 'Video recorder' })
      await vi.waitFor(() => expect(recorder).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  // Removing imported audio selects the next imported file, and the same button then removes that one.
  it('keeps the focus off Remove selected imported asset once the next file is selected', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const asset = (id: string) => ({ id, name: `${id}.mp3`, durationMs: 1000, provenance: 'Recorded by the team', builtin: false })
    const removed = deferred<BrowserVideoState>()
    const view = renderRecorder({ ...state('stopped'), audioAssets: [asset('first'), asset('second')] }, removed.promise)
    const observer = emulateChromiumFocusFixup()
    try {
      const remove = await screen.findByRole('button', { name: 'Remove selected imported asset', hidden: true })
      remove.focus()
      remove.click()
      await vi.waitFor(() => expect(remove).toBeDisabled())
      removed.resolve({ ...state('stopped'), audioAssets: [asset('second')] })
      await vi.waitFor(() => expect(remove).toBeEnabled())
      expect(remove.isConnected).toBe(true)
      const recorder = screen.getByRole('region', { name: 'Video recorder' })
      await vi.waitFor(() => expect(recorder).toHaveFocus())
    } finally { observer.disconnect(); view.unmount() }
  })

  it('leaves newer focus alone when the action finishes', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    const saved = deferred<BrowserVideoState>()
    const outside = document.body.appendChild(document.createElement('button'))
    const view = renderRecorder(state('stopped'), saved.promise)
    const observer = emulateChromiumFocusFixup()
    try {
      const add = await screen.findByRole('button', { name: 'Add annotation' })
      const user = userEvent.setup()
      await user.type(screen.getByLabelText('Caption text'), 'Click Publish')
      await user.click(add)
      await vi.waitFor(() => expect(add).toBeDisabled())
      outside.focus()
      saved.resolve(state('stopped'))
      await vi.waitFor(() => expect(add).toBeEnabled())
      expect(outside).toHaveFocus()
    } finally { observer.disconnect(); view.unmount(); outside.remove() }
  })
})
