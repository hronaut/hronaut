import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test, expect } from './fixtures.js'
import { armFirstFrame, disposeFirstFrame, expectGreenFirstFrame, readFirstFrame } from './video-first-frame.js'

type FaultWindow = Window & { restoreFrameFault?: () => void }
const clip = (name: string) => readFile(fileURLToPath(new URL(`../fixtures/first-frame/${name}.webm`, import.meta.url)))
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

for (const first of ['red', 'green'] as const) {
  test(`first-frame oracle uses ${first} first frame regardless of opposite later frame`, async ({ appWindow }, testInfo) => {
    const bytes = await clip(first === 'red' ? 'red-green' : 'green-red')
    await armFirstFrame(appWindow, { sha256: hash(bytes), width: 128, height: 72 })
    try {
      await appWindow.evaluate(data => {
        const video = document.createElement('video'); video.controls = true
        document.body.append(video)
        video.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'video/webm' }))
      }, bytes.toString('base64'))
      const sample = await readFirstFrame(appWindow)
      await testInfo.attach('first-frame-control', { body: JSON.stringify(sample), contentType: 'application/json' })
      expect(sample.error).toBeUndefined()
      expect(sample.metadata).toMatchObject({ mediaTime: 0, presentedFrames: 1 })
      if (first === 'green') {
        expectGreenFirstFrame(sample)
        // Exactly +70 must fail on each channel independently, not merely >=70.
        expect(() => expectGreenFirstFrame({ ...sample, pixel: [100, 170, 0, 255] })).toThrow()
        expect(() => expectGreenFirstFrame({ ...sample, pixel: [0, 170, 100, 255] })).toThrow()
      } else expect(() => expectGreenFirstFrame(sample)).toThrow()
    } finally {
      await disposeFirstFrame(appWindow)
      await appWindow.evaluate(() => { const video = document.querySelector('video')!; const source = video.src; video.remove(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(source) })
    }
  })
}

for (const fault of ['skip-first', 'later-frame', 'later-time', 'missing-callback', 'missing-api', 'decode-error', 'wrong-bytes', 'source-replaced', 'element-replaced', 'wrong-size'] as const) {
  test(`first-frame oracle fails closed: ${fault}`, async ({ appWindow }, testInfo) => {
    const bytes = fault === 'decode-error' ? Buffer.from('not a video') : await clip('green-red')
    await appWindow.evaluate(fault => {
      const prototype = HTMLVideoElement.prototype
      const original = prototype.requestVideoFrameCallback
      if (fault === 'missing-api') Object.defineProperty(prototype, 'requestVideoFrameCallback', { configurable: true, value: undefined })
      else if (fault === 'missing-callback') prototype.requestVideoFrameCallback = () => 0
      else if (['skip-first', 'later-frame', 'later-time'].includes(fault)) {
        prototype.requestVideoFrameCallback = function (callback) {
          return original.call(this, (now, metadata) => {
            if (fault === 'skip-first') return
            callback(now, { ...metadata, ...(fault === 'later-frame' ? { presentedFrames: 2 } : { mediaTime: 1 }) })
          })
        }
      }
      ;(window as FaultWindow).restoreFrameFault = () => { Object.defineProperty(prototype, 'requestVideoFrameCallback', { configurable: true, writable: true, value: original }); delete (window as FaultWindow).restoreFrameFault }
    }, fault)
    await armFirstFrame(appWindow, { sha256: fault === 'wrong-bytes' ? hash(await clip('red-green')) : hash(bytes), width: fault === 'wrong-size' ? 129 : 128, height: 72, timeoutMs: 1000 })
    try {
      await appWindow.evaluate(({ data, fault }) => {
        const video = document.createElement('video'); video.controls = true
        document.body.append(video)
        const source = URL.createObjectURL(new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: 'video/webm' }))
        video.src = source
        if (fault === 'source-replaced') video.src = source
        if (fault === 'element-replaced') { video.remove(); const other = document.createElement('video'); document.body.append(other); other.src = source }
      }, { data: bytes.toString('base64'), fault })
      const sample = await readFirstFrame(appWindow)
      await testInfo.attach('first-frame-rejection', { body: JSON.stringify({ fault, sample }), contentType: 'application/json' })
      const expectedErrors = {
        'skip-first': 'First presented frame deadline exceeded', 'missing-callback': 'First presented frame deadline exceeded',
        'later-frame': 'Callback is not the first paused frame at time zero', 'later-time': 'Callback is not the first paused frame at time zero',
        'missing-api': 'Frame presentation API unavailable', 'decode-error': 'Preview decode failed',
        'wrong-bytes': 'Preview bytes do not match the exported clip', 'source-replaced': 'Preview source assigned more than once',
        'element-replaced': 'Preview element or source replaced', 'wrong-size': 'First-frame dimensions differ'
      }
      expect(sample.error).toBe(expectedErrors[fault])
      expect(() => expectGreenFirstFrame(sample)).toThrow()
    } finally {
      await disposeFirstFrame(appWindow)
      await appWindow.evaluate(() => {
        for (const video of document.querySelectorAll('video')) { const source = video.src; video.remove(); video.removeAttribute('src'); video.load(); URL.revokeObjectURL(source) }
        ;(window as FaultWindow).restoreFrameFault?.()
      })
    }
  })
}
