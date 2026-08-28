const WINDOWS_RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i

export function isWindowsReservedFilename(value: string): boolean {
  const stem = value.split('.', 1)[0]?.replace(/[ .]+$/g, '') ?? ''
  return WINDOWS_RESERVED_DEVICE_NAME.test(stem)
}
