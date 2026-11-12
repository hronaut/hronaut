import { SITE_SOUND_PERMISSION } from './site-permission-names.js'

/**
 * The permissions websites ask for first, as in Chrome, in the order Settings → Site permissions lists their default
 * behaviour. The person can block each one for every website; a decision saved for a website still wins.
 */
export const SITE_PERMISSIONS_ASKED_FIRST: readonly string[] = [
  'geolocation',
  'camera',
  'microphone',
  'notifications',
  'clipboard-read',
  'midi',
  'midiSysex',
  'pointerLock',
  'keyboardLock',
  'idle-detection',
  'window-management',
  'local-fonts',
  'local-network',
  'loopback-network',
  'speaker-selection'
]

/**
 * What Chrome gives every website without asking, and Hronaut too: writing text or images to the clipboard, protected
 * content (DRM), keeping the screen on, persistent storage, an embedded website's own cookies, and motion sensors. The
 * person can block each one for every website, and websites play sound unless they mute it for every website.
 */
export const SITE_PERMISSIONS_ALLOWED_WITHOUT_ASKING: readonly string[] = [
  'clipboard-sanitized-write',
  'mediaKeySystem',
  'screen-wake-lock',
  'persistent-storage',
  'storage-access',
  'sensors'
]

/** Every permission Settings lists a default behaviour for, in its order: the asked ones, the allowed ones, then Sound. */
export const SITE_PERMISSIONS_WITH_DEFAULTS: readonly string[] = [
  ...SITE_PERMISSIONS_ASKED_FIRST,
  ...SITE_PERMISSIONS_ALLOWED_WITHOUT_ASKING,
  SITE_SOUND_PERMISSION
]

/**
 * The permission whose default behaviour applies to a request: Chromium's older name for local network access, which
 * covered both local network devices and apps on this device, follows the Local network devices default.
 */
export function sitePermissionWithDefault(permission: string): string {
  return permission === 'local-network-access' ? 'local-network' : permission
}

/** Whether `value` names permissions the person blocked for every website: listed ones, each once. */
export function isSitePermissionsBlockedByDefault(value: unknown): value is string[] {
  return Array.isArray(value)
    && new Set(value).size === value.length
    && value.every((permission) => typeof permission === 'string' && SITE_PERMISSIONS_WITH_DEFAULTS.includes(permission))
}

/** The permissions blocked for every website in the order Settings lists them, or none when `value` is not such a list. */
export function readSitePermissionsBlockedByDefault(value: unknown): string[] {
  if (!isSitePermissionsBlockedByDefault(value)) return []
  return SITE_PERMISSIONS_WITH_DEFAULTS.filter((permission) => value.includes(permission))
}
