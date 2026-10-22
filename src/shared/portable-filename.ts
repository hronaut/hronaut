const WINDOWS_RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i

export function isWindowsReservedFilename(value: string): boolean {
  const stem = value.split('.', 1)[0] ?? ''
  // Windows ignores trailing spaces after a device name. Counting them back one at a time, rather than with a pattern,
  // keeps a download name of many spaces fast.
  let end = stem.length
  while (end > 0 && stem[end - 1] === ' ') end -= 1
  return WINDOWS_RESERVED_DEVICE_NAME.test(stem.slice(0, end))
}

// writeUniqueDownload can append " (9999)" before the extension. Keep that
// seven-byte suffix within the common 255-byte filesystem component limit.
const MAX_EXPORT_FILENAME_BYTES = 255 - 7
const encoder = new TextEncoder()

export function portableExportFilename(requested: string | undefined, title: string, format: 'pdf' | 'har' | 'png' | 'html'): string {
  const extension = `.${format}`
  if (requested !== undefined) {
    const filename = requested.trim()
    const result = filename.toLowerCase().endsWith(extension) ? filename : `${filename}${extension}`
    if (
      !filename
      // A name starting with a dot is hidden on macOS and Linux, and `.pdf` alone has no name before its extension.
      || filename.startsWith('.')
      || filename.length > 180
      || /[\u0000-\u001f<>:"/\\|?*]/.test(filename)
      || /[. ]$/.test(filename)
      || isWindowsReservedFilename(filename)
      || encoder.encode(result).byteLength > MAX_EXPORT_FILENAME_BYTES
    ) throw new Error(`${format.toUpperCase()} filename must be a portable file name without a directory path`)
    return result
  }

  const suffix = format === 'har' ? '.sanitized.har' : extension
  const fallback = format === 'har' ? 'network' : 'page'
  const maxCharacters = format === 'har' ? 150 : 160
  let normalized = title
    // A format character such as a right-to-left override would show the name in another order, hiding its extension.
    // The joiners stay, as Chromium keeps them: scripts such as Persian and emoji such as 👩‍💻 need them.
    .replace(/(?![\u200C\u200D])\p{Cf}/gu, '')
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    // A title such as `.NET documentation` would otherwise make a file that macOS and Linux hide.
    .replace(/^[. ]+/, '')
  if (isWindowsReservedFilename(normalized)) normalized = `${fallback}-${normalized}`
  let stem = ''
  let bytes = encoder.encode(suffix).byteLength
  for (const character of normalized) {
    const characterBytes = encoder.encode(character).byteLength
    if (stem.length + character.length > maxCharacters || bytes + characterBytes > MAX_EXPORT_FILENAME_BYTES) break
    stem += character
    bytes += characterBytes
  }
  stem = stem.replace(/[. ]+$/g, '') || fallback
  if (isWindowsReservedFilename(stem)) stem = `${fallback}-${stem}`
  return `${stem}${suffix}`
}
