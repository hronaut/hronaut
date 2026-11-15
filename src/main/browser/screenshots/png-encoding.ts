import { crc32, deflateSync } from 'node:zlib'

// A screenshot's PNG, made in the image encoder's worker: Node built-ins only, as the worker runs them under test as they are.

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

/** An 8-bit RGBA PNG of the pixels, their colour taken out of the alpha again as Chromium's own encoder does. */
export function pngOfBitmap(width: number, height: number, order: 'bgra' | 'rgba', pixels: Uint8Array): Uint8Array {
  if (pixels.length !== width * height * 4) throw new RangeError('The bitmap does not match its size')
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  header[8] = 8 // bits per channel
  header[9] = 6 // RGBA
  const rows = filteredRows(width, height, straightRgba(order, pixels))
  // Level 4 took half to four fifths of the time of zlib's default, 6, on the captures filteredRows names, for PNGs at most
  // a sixth larger than Chromium's own encoder made of them.
  const parts = [SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 4 })), chunk('IEND', new Uint8Array(0))]
  const png = new Uint8Array(parts.reduce((length, part) => length + part.length, 0))
  let offset = 0
  for (const part of parts) {
    png.set(part, offset)
    offset += part.length
  }
  return png
}

/** The pixels as RGBA whose colour no longer carries the alpha, as PNG keeps them. */
function straightRgba(order: 'bgra' | 'rgba', pixels: Uint8Array): Uint8Array {
  const red = order === 'bgra' ? 2 : 0
  const blue = 2 - red
  const rgba = new Uint8Array(pixels.length)
  for (let at = 0; at < pixels.length; at += 4) {
    const alpha = pixels[at + 3]!
    if (alpha === 0) continue
    const r = pixels[at + red]!
    const g = pixels[at + 1]!
    const b = pixels[at + blue]!
    if (alpha === 255) {
      rgba[at] = r
      rgba[at + 1] = g
      rgba[at + 2] = b
    } else {
      rgba[at] = Math.min(255, Math.round(r * 255 / alpha))
      rgba[at + 1] = Math.min(255, Math.round(g * 255 / alpha))
      rgba[at + 2] = Math.min(255, Math.round(b * 255 / alpha))
    }
    rgba[at + 3] = alpha
  }
  return rgba
}

/**
 * The rows, each after PNG's Sub filter, which keeps each byte as its difference from the same channel of the pixel to its
 * left, so that flat colour becomes zeros. On captures of a shop page, an article, a dashboard and a photo it compressed
 * as well as the Paeth filter, which took four times as long.
 */
function filteredRows(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const stride = width * 4
  const rows = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * stride
    const out = y * (stride + 1) + 1
    rows[out - 1] = 1
    rows.set(rgba.subarray(row, row + 4), out)
    for (let x = 4; x < stride; x += 1) rows[out + x] = (rgba[row + x]! - rgba[row + x - 4]!) & 0xff
  }
  return rows
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}
