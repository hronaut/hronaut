import type { MessageKey } from './i18n.js'

/** The message naming each permission websites ask for, by Chromium's identifier. */
const SITE_PERMISSION_NAMES: Readonly<Record<string, MessageKey>> = {
  'clipboard-read': 'runtime.permissions.clipboardRead',
  'clipboard-sanitized-write': 'runtime.permissions.clipboardWrite',
  'display-capture': 'runtime.permissions.display',
  fileSystem: 'runtime.permissions.files',
  fullscreen: 'runtime.permissions.fullscreen',
  geolocation: 'runtime.permissions.location',
  'idle-detection': 'runtime.permissions.activity',
  media: 'runtime.permissions.media',
  notifications: 'runtime.permissions.notifications',
  'storage-access': 'runtime.permissions.storage',
  'top-level-storage-access': 'runtime.permissions.relatedStorage',
  'window-management': 'runtime.permissions.windows'
}

/**
 * The name people see for a permission a website asks for, such as "Location" for "geolocation", in both the
 * permission prompt and Settings → Site permissions. A permission without a name shows its identifier with hyphens
 * as spaces.
 */
export function sitePermissionName(permission: string, text: (key: MessageKey) => string): string {
  return Object.hasOwn(SITE_PERMISSION_NAMES, permission)
    ? text(SITE_PERMISSION_NAMES[permission]!)
    : permission.replaceAll('-', ' ')
}
