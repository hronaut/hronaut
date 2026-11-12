import type { MessageKey } from './translate.js'

/**
 * Chrome's Sound site setting, which no website asks for: Mute Site saves it as a deny decision, so the website's pages
 * play no sound, and Settings shows that decision as Mute.
 */
export const SITE_SOUND_PERMISSION = 'sound'

/**
 * The message naming each permission websites ask for, by Chromium's identifier, and the camera and the microphone,
 * which Hronaut remembers each on its own.
 */
const SITE_PERMISSION_NAMES: Readonly<Record<string, MessageKey>> = {
  camera: 'runtime.permissions.camera',
  'clipboard-read': 'runtime.permissions.clipboardRead',
  'clipboard-sanitized-write': 'runtime.permissions.clipboardWrite',
  'display-capture': 'runtime.permissions.display',
  fileSystem: 'runtime.permissions.files',
  geolocation: 'runtime.permissions.location',
  'idle-detection': 'runtime.permissions.activity',
  keyboardLock: 'runtime.permissions.keyboardLock',
  'local-fonts': 'runtime.permissions.localFonts',
  // Chromium's Local Network Access: a website reaching a device on the local network (local-network-access is its older,
  // combined name), or an app on this device (loopback-network).
  'local-network': 'runtime.permissions.localNetwork',
  'local-network-access': 'runtime.permissions.localNetwork',
  'loopback-network': 'runtime.permissions.loopbackNetwork',
  media: 'runtime.permissions.media',
  mediaKeySystem: 'runtime.permissions.protectedContent',
  microphone: 'runtime.permissions.microphone',
  midi: 'runtime.permissions.midi',
  midiSysex: 'runtime.permissions.midiControl',
  notifications: 'runtime.permissions.notifications',
  openExternal: 'runtime.permissions.externalApps',
  'persistent-storage': 'runtime.permissions.persistentStorage',
  pointerLock: 'runtime.permissions.pointerLock',
  'screen-wake-lock': 'runtime.permissions.screenAwake',
  sensors: 'runtime.permissions.motionSensors',
  [SITE_SOUND_PERMISSION]: 'runtime.permissions.sound',
  'speaker-selection': 'runtime.permissions.speakers',
  'storage-access': 'runtime.permissions.storage',
  'window-management': 'runtime.permissions.windows'
}

/**
 * The name people see for a permission a website asks for, such as "Location" for "geolocation", in both the
 * permission prompt and Settings → Site permissions. A permission without a name shows its identifier with hyphens
 * as spaces. The prompt names only the device a camera or microphone request still asks for, as Camera or Microphone.
 */
export function sitePermissionName(permission: string, text: (key: MessageKey) => string): string {
  return Object.hasOwn(SITE_PERMISSION_NAMES, permission)
    ? text(SITE_PERMISSION_NAMES[permission]!)
    : permission.replaceAll('-', ' ')
}
