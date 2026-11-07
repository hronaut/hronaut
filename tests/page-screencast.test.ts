import { describe, expect, it } from 'vitest'
import { combinedScreencastSettings } from '../src/main/browser/page-screencast/page-screencast.js'

describe('shared page screencast', () => {
  it('runs at the largest size and quality and the most frequent frames any reader asked for', () => {
    expect(combinedScreencastSettings([
      { maxWidth: 640, maxHeight: 360, quality: 60, everyNthFrame: 3 },
      { maxWidth: 1280, maxHeight: 720, quality: 80, everyNthFrame: 1 }
    ])).toEqual({ maxWidth: 1280, maxHeight: 720, quality: 80, everyNthFrame: 1 })
  })
})
