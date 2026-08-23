import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES,
  MEMORY_SAVER_TIMEOUT_MINUTES,
  isMemorySaverTimeoutMinutes,
  memorySaverCutoff
} from '../src/shared/memory-saver.js'

describe('memory saver settings', () => {
  it('exposes bounded inactivity choices with a conservative default', () => {
    expect(MEMORY_SAVER_TIMEOUT_MINUTES).toEqual([5, 15, 30, 60, 120, 240])
    expect(DEFAULT_MEMORY_SAVER_TIMEOUT_MINUTES).toBe(60)
    for (const timeout of MEMORY_SAVER_TIMEOUT_MINUTES) expect(isMemorySaverTimeoutMinutes(timeout)).toBe(true)
    for (const value of [0, 10, 61, 60.5, '60', null]) expect(isMemorySaverTimeoutMinutes(value)).toBe(false)
  })

  it('derives the exact inactivity cutoff', () => {
    expect(memorySaverCutoff(10_000_000, 15)).toBe(9_100_000)
  })
})
