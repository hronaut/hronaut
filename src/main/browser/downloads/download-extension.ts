import { extname } from 'node:path'

/** Endings after which Chrome counts a short part before them as part of the extension, as in `.tar.gz` or `.tar.zst`. */
const COMPRESSED_ENDING = /^\.(?:bz2?|gz|lz(?:ma|o)?|xz|z|zst)$/i

/**
 * A download name's extension as Chrome reads it: one to four characters before a compressed ending count as part of
 * it, as does `.user` before `.js`, so a second `release.tar.gz` is saved as `release (1).tar.gz` rather than
 * `release.tar (1).gz`, and a shortened name keeps both parts.
 */
export function downloadExtension(filename: string): string {
  const final = extname(filename)
  if (!final) return final
  const inner = extname(filename.slice(0, -final.length))
  if (inner.length < 2) return final
  if ((inner + final).toLowerCase() === '.user.js') return inner + final
  return COMPRESSED_ENDING.test(final) && inner.length <= 5 ? inner + final : final
}
