import { pageScript } from '../../shared/page-script.js'
import type { BrowserMediaState } from '../../shared/types.js'
import { ISOLATED_WORLDS } from './isolated-worlds.js'
import { mediaStateInPage, mediaStateSettlementInPage } from './media-state.page.js'

export const MEDIA_STATE_WORLD_ID = ISOLATED_WORLDS.mediaState

export function mediaStateScript(target: { selector: string }, token: string): string {
  if (Object.hasOwn(target, 'ref')) throw new TypeError('Media state does not support snapshot refs; provide a unique selector')
  return pageScript(mediaStateInPage, target, token)
}

export function mediaStateSettlementScript(token: string, cancel = false): string {
  return pageScript(mediaStateSettlementInPage, token, cancel)
}

export function normalizeMediaState(raw: unknown): BrowserMediaState {
  const invalid = () => { throw new Error('Media state unavailable: invalid native report') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length === 1 && typeof value.failure === 'string') {
    const failures: Record<string, string> = {
      busy: 'Media state unavailable: inspection busy',
      'invalid-selector': 'Media state requires a valid selector',
      'non-unique-target': 'Media state requires one unique current target',
      'unsupported-target': 'Media state unsupported: select a top-level audio or video element',
      'native-unavailable': 'Media state unavailable: native scalar acquisition failed'
    }
    if (Object.hasOwn(failures, value.failure)) throw new Error(failures[value.failure])
  }
  const keys = ['kind', 'observedAt', 'paused', 'ended', 'seeking', 'muted', 'volume', 'playbackRate', 'currentTime', 'duration', 'readyState', 'networkState', 'errorCode']
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) return invalid()
  const finite = (name: string, min: number, max: number, integer = false) => {
    const item = value[name]
    return typeof item === 'number' && Number.isFinite(item) && item >= min && item <= max && (!integer || Number.isInteger(item))
  }
  if (!['audio', 'video'].includes(value.kind as string) || !finite('observedAt', 0, Number.MAX_SAFE_INTEGER, true)
    || ['paused', 'ended', 'seeking', 'muted'].some(key => typeof value[key] !== 'boolean')
    || !finite('volume', 0, 1) || !finite('playbackRate', -1024, 1024) || !finite('currentTime', 0, Number.MAX_SAFE_INTEGER)
    || !finite('readyState', 0, 4, true) || !finite('networkState', 0, 3, true)
    || (value.errorCode !== null && !finite('errorCode', 1, 4, true))) return invalid()
  const duration = value.duration as Record<string, unknown> | null
  if (!duration || typeof duration !== 'object' || Array.isArray(duration)) return invalid()
  if (duration.state === 'finite') {
    if (Object.keys(duration).length !== 2 || typeof duration.seconds !== 'number' || !Number.isFinite(duration.seconds) || duration.seconds < 0 || duration.seconds > Number.MAX_SAFE_INTEGER) return invalid()
  } else if (!['unknown', 'infinite'].includes(duration.state as string) || Object.keys(duration).length !== 1) return invalid()
  if (JSON.stringify(value).length > 1024) return invalid()
  return value as unknown as BrowserMediaState
}
