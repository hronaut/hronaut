import type { MessageKey } from './i18n.js'

/**
 * Chrome's Sound site setting, which no website asks for: Mute Site saves it as a deny decision, so the website's pages
 * play no sound, and Settings shows that decision as Mute.
 */
export const SITE_SOUND_PERMISSION = 'sound'

/** The message naming each permission websites ask for, by Chromium's identifier. */
const SITE_PERMISSION_NAMES: Readonly<Record<string, MessageKey>> = {
  'clipboard-read': 'runtime.permissions.clipboardRead',
  'clipboard-sanitized-write': 'runtime.permissions.clipboardWrite',
  'display-capture': 'runtime.permissions.display',
  fileSystem: 'runtime.permissions.files',
  fullscreen: 'runtime.permissions.fullscreen',
  geolocation: 'runtime.permissions.location',
  'idle-detection': 'runtime.permissions.activity',
  keyboardLock: 'runtime.permissions.keyboardLock',
  media: 'runtime.permissions.media',
  midiSysex: 'runtime.permissions.midiControl',
  notifications: 'runtime.permissions.notifications',
  openExternal: 'runtime.permissions.externalApps',
  'persistent-storage': 'runtime.permissions.persistentStorage',
  pointerLock: 'runtime.permissions.pointerLock',
  'screen-wake-lock': 'runtime.permissions.screenAwake',
  [SITE_SOUND_PERMISSION]: 'runtime.permissions.sound',
  'storage-access': 'runtime.permissions.storage',
  'top-level-storage-access': 'runtime.permissions.relatedStorage',
  'window-management': 'runtime.permissions.windows'
}

/**
 * The name people see for a permission a website asks for, such as "Location" for "geolocation", in both the
 * permission prompt and Settings → Site permissions. A permission without a name shows its identifier with hyphens
 * as spaces. The prompt names a camera-only or microphone-only request by its one device instead.
 */
export function sitePermissionName(permission: string, text: (key: MessageKey) => string): string {
  return Object.hasOwn(SITE_PERMISSION_NAMES, permission)
    ? text(SITE_PERMISSION_NAMES[permission]!)
    : permission.replaceAll('-', ' ')
}
