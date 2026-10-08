import { describe, expect, it } from 'vitest'
import { mediaStateScript, normalizeMediaState } from '../src/main/browser/media-state.js'
const report = () => ({ kind: 'audio', observedAt: 123, paused: true, ended: false, seeking: false, muted: false, volume: 1, playbackRate: 1, currentTime: 0, duration: { state: 'unknown' }, readyState: 0, networkState: 0, errorCode: null })
describe('bounded native media report', () => {
  it.each([{ state: 'unknown' }, { state: 'infinite' }, { state: 'finite', seconds: 1.5 }])('retains explicit duration %j and native errors without messages', duration => {
    const raw = { ...report(), duration, errorCode: 4 }
    expect(normalizeMediaState(raw)).toEqual(raw)
  })
  it.each([
    { currentSrc: 'private' }, { message: 'private' }, { volume: 1.1 }, { volume: -1 }, { volume: NaN },
    { paused: 'false' }, { kind: 'iframe' }, { currentTime: Infinity }, { currentTime: -1 },
    { playbackRate: 1025 }, { readyState: 5 }, { networkState: 4 }, { errorCode: 0 }, { errorCode: 5 },
    { observedAt: -1 }, { observedAt: 1.5 }, { duration: { state: 'finite', seconds: Infinity } },
    { duration: { state: 'unknown', seconds: 0 } }, { duration: { state: 'finite', seconds: 2, metadata: 'private' } },
    { errorCode: { code: 4, message: 'private' } }
  ])('rejects malformed or extra data %j', delta => {
    expect(() => normalizeMediaState({ ...report(), ...delta })).toThrow('invalid native report')
  })
})


it.each([
  ['busy', 'unavailable'], ['invalid-selector', 'valid selector'], ['non-unique-target', 'unique current target'],
  ['unsupported-target', 'unsupported'], ['native-unavailable', 'unavailable']
])('preserves fixed failure outcome %s without arbitrary messages', (failure, message) => {
  expect(() => normalizeMediaState({ failure })).toThrow(message)
  expect(() => normalizeMediaState({ failure, message: 'private source' })).toThrow('invalid native report')
})


it('rejects ref input before acquisition script construction instead of silently ignoring it', () => {
  const input = { selector: '#current', ref: 'e1' }
  expect(() => mediaStateScript(input, 'proof')).toThrow('does not support snapshot refs')
})
