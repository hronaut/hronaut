import { expect, it } from 'vitest'
import { translate } from '../src/shared/i18n.js'
import { SUPPORTED_LOCALES } from '../src/shared/locale.js'
import { VIDEO_LIMITS, VIDEO_RECORDING_NOTICES } from '../src/shared/video.js'

// The recorder said a recording stops at its 64 MiB limit and records up to 12 fps after the limits became 256 MiB
// and 30 frames a second.
it('names the size and frame rate the recorder enforces, in every language', () => {
  const mebibytes = String(VIDEO_LIMITS.bytes / 1024 / 1024)
  const fps = String(VIDEO_LIMITS.framesPerSecond)
  expect(VIDEO_RECORDING_NOTICES.sizeLimit).toContain(`${mebibytes} MiB`)
  for (const locale of SUPPORTED_LOCALES) {
    const sizeLimit = translate(locale, 'video.notices.sizeLimit').replace(/\u00a0/g, ' ')
    const limits = translate(locale, 'video.limits').replace(/\u00a0/g, ' ')
    expect(sizeLimit, locale).toMatch(new RegExp(`\\b${mebibytes} Mi?o?B?\\b`))
    expect(sizeLimit, locale).not.toMatch(/\b64 Mi/)
    expect(limits, locale).toMatch(new RegExp(`\\b${fps} ?fps`))
    expect(limits, locale).toContain(`${VIDEO_LIMITS.width} × ${VIDEO_LIMITS.height}`)
  }
})
