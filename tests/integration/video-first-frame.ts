import type { Page } from '@playwright/test'
import { expect } from './fixtures.js'

export type FirstFrameSample = {
  error?: string
  pixel?: number[]
  source?: string
  sha256?: string
  currentTime?: number
  readyState?: number
  paused?: boolean
  seeking?: boolean
  width?: number
  height?: number
  metadata?: { mediaTime: number; presentedFrames: number; width: number; height: number }
}
type Probe = { result: Promise<FirstFrameSample>; dispose(): void }
type ProbeWindow = Window & { firstFrameProbe?: Probe }

// Arm before the UI assigns its fresh video's src. This hook observes the real
// element and bytes; it never replaces the preview, seeks, plays, or retries.
export async function armFirstFrame(page: Page, expected: { sha256: string; width: number; height: number; timeoutMs?: number }): Promise<void> {
  await page.evaluate(expected => {
    const scope = window as ProbeWindow
    if (scope.firstFrameProbe || document.querySelector('video')) throw new Error('First-frame observation requires a fresh preview')
    const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src')!
    let resolve!: (sample: FirstFrameSample) => void
    const result = new Promise<FirstFrameSample>(done => { resolve = done })
    let settled = false
    let disposed = false
    let target: HTMLVideoElement | undefined
    let source: string | undefined
    let callbackId: number | undefined
    let sample: FirstFrameSample | undefined
    let digest: string | undefined
    const fetchAbort = new AbortController()
    const finish = (value: FirstFrameSample): void => {
      if (settled || disposed) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const fail = (error: string): void => finish({ ...sample, error })
    const complete = (): void => {
      if (!sample || !digest) return
      if (digest !== expected.sha256) { fail('Preview bytes do not match the exported clip'); return }
      finish({ ...sample, sha256: digest })
    }
    const onError = (): void => fail('Preview decode failed')
    const timer = setTimeout(() => fail('First presented frame deadline exceeded'), expected.timeoutMs ?? 5000)
    const observer = new MutationObserver(() => {
      if (target && (!target.isConnected || target.src !== source)) fail('Preview element or source replaced')
    })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...descriptor,
      set(value: string) {
        if (this instanceof HTMLVideoElement && !settled && !disposed) {
          if (target) { fail(this === target ? 'Preview source assigned more than once' : 'Preview element or source replaced'); descriptor.set!.call(this, value); return }
          target = this
          source = String(value)
          if (target.hasAttribute('src') || target.currentSrc || target.readyState !== 0 || !source.startsWith('blob:')) fail('Preview source is not fresh')
          else if (typeof target.requestVideoFrameCallback !== 'function' || typeof target.cancelVideoFrameCallback !== 'function') fail('Frame presentation API unavailable')
          else {
            target.addEventListener('error', onError)
            callbackId = target.requestVideoFrameCallback((_now, metadata) => {
              if (settled || disposed) return
              const video = target!
              // Draw synchronously in the FIRST callback, before any async work.
              // Never accept a later, more convenient media time or pixel.
              sample = {
                source: video.currentSrc, currentTime: video.currentTime, readyState: video.readyState,
                paused: video.paused, seeking: video.seeking, width: video.videoWidth, height: video.videoHeight,
                metadata: { mediaTime: metadata.mediaTime, presentedFrames: metadata.presentedFrames, width: metadata.width, height: metadata.height }
              }
              if (!video.isConnected || document.querySelector('video') !== video || video.currentSrc !== source || video.src !== source) { fail('Preview element or source replaced'); return }
              if (!video.paused || video.seeking || video.currentTime !== 0 || metadata.mediaTime !== 0 || metadata.presentedFrames !== 1) { fail('Callback is not the first paused frame at time zero'); return }
              if (video.videoWidth !== expected.width || video.videoHeight !== expected.height || metadata.width !== expected.width || metadata.height !== expected.height) { fail('First-frame dimensions differ'); return }
              try {
                const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight
                const context = canvas.getContext('2d')!
                context.drawImage(video, 0, 0)
                sample.pixel = [...context.getImageData(Math.round(canvas.width * 0.1), Math.round(canvas.height * 0.25), 1, 1).data]
              } catch { fail('First-frame pixel readback failed'); return }
              complete()
            })
            void fetch(source, { signal: fetchAbort.signal }).then(async response => {
              if (!response.ok) throw new Error('Unreadable preview')
              const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
              if (settled || disposed) return
              digest = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
              complete()
            }).catch(() => fail('Preview bytes unavailable'))
          }
        }
        descriptor.set!.call(this, value)
      }
    })
    scope.firstFrameProbe = { result, dispose() {
      if (!settled) fail('First-frame observation disposed before completion')
      disposed = true
      clearTimeout(timer)
      observer.disconnect()
      fetchAbort.abort()
      if (target && callbackId !== undefined && typeof target.cancelVideoFrameCallback === 'function') target.cancelVideoFrameCallback(callbackId)
      target?.removeEventListener('error', onError)
      Object.defineProperty(HTMLMediaElement.prototype, 'src', descriptor)
      delete scope.firstFrameProbe
    } }
  }, expected)
}

export async function readFirstFrame(page: Page): Promise<FirstFrameSample> {
  return page.evaluate(async () => {
    const probe = (window as ProbeWindow).firstFrameProbe
    if (!probe) throw new Error('First-frame observer was not armed')
    return probe.result
  })
}

export async function disposeFirstFrame(page: Page): Promise<void> {
  await page.evaluate(() => (window as ProbeWindow).firstFrameProbe?.dispose())
}

export function expectGreenFirstFrame(sample: FirstFrameSample): void {
  expect(sample.error, JSON.stringify(sample)).toBeUndefined()
  expect(sample.pixel).toHaveLength(4)
  expect(sample.pixel![1]).toBeGreaterThan(sample.pixel![0]! + 70)
  expect(sample.pixel![1]).toBeGreaterThan(sample.pixel![2]! + 70)
}
