import { nativeImage } from 'electron'
import { isIP } from 'node:net'
import { qrCode } from '../../../shared/qr-code.js'

/** The white margin a scanner needs around a code, in modules. */
const QUIET_ZONE_MODULES = 4
/** About how wide the image is, in pixels; each module is a whole number of pixels, at least three. */
const IMAGE_WIDTH = 600

/**
 * The pixels of a QR code image: dark modules on white, with the quiet zone around them, each module a square of whole
 * pixels. The pixels are 32-bit BGRA, as Electron's `nativeImage.createFromBitmap` takes them.
 */
export function qrCodeBitmap(modules: readonly (readonly boolean[])[]): { width: number, height: number, data: Buffer } {
  const scale = Math.max(3, Math.floor(IMAGE_WIDTH / (modules.length + QUIET_ZONE_MODULES * 2)))
  const width = (modules.length + QUIET_ZONE_MODULES * 2) * scale
  const data = Buffer.alloc(width * width * 4, 0xFF)
  modules.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return
    for (let dy = 0; dy < scale; dy++) {
      const start = (((y + QUIET_ZONE_MODULES) * scale + dy) * width + (x + QUIET_ZONE_MODULES) * scale) * 4
      for (let pixel = start; pixel < start + scale * 4; pixel += 4) data.fill(0, pixel, pixel + 3)
    }
  }))
  return { width, height: width, data }
}

/** A PNG of the text's QR code, or undefined for text longer than a QR code holds. */
export function qrCodePng(text: string): Buffer | undefined {
  const modules = qrCode(text)
  if (!modules) return undefined
  const { width, height, data } = qrCodeBitmap(modules)
  return nativeImage.createFromBitmap(data, { width, height }).toPNG()
}

/**
 * The name Chrome gives a downloaded QR code, after the address it was made for: `qrcode_` and the host, or
 * `qrcode_hronaut.png` for an address with no host name, such as an IP address. A host name with characters a file name
 * cannot hold everywhere, as `a*b` can be, names no file either.
 */
export function qrCodeFilename(address: string): string {
  let host = ''
  try {
    host = new URL(address).hostname
  } catch {
    // An address that does not parse names no host.
  }
  const bare = host.startsWith('[') ? host.slice(1, -1) : host
  return /^[a-z0-9._-]+$/.test(host) && !isIP(bare) ? `qrcode_${host}.png` : 'qrcode_hronaut.png'
}
