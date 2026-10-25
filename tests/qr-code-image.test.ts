import { describe, expect, it, vi } from 'vitest'
import { qrCode } from '../src/shared/qr-code.js'

vi.mock('electron', () => ({
  nativeImage: {
    createFromBitmap: (data: Buffer, size: { width: number, height: number }) => ({
      toPNG: () => Buffer.concat([Buffer.from(`${size.width}x${size.height}:`), data])
    })
  }
}))

const { qrCodeBitmap, qrCodeFilename, qrCodePng } = await import('../src/main/browser/qr-code/qr-code-image.js')

// The Create QR Code dialog's Copy and Download had no image to give: main draws one from the code's modules.

describe('the QR code image', () => {
  it('draws each module as a square of whole pixels, dark on white, with the quiet zone around the code', () => {
    const modules = qrCode('https://hronaut.dev/')!
    const { width, height, data } = qrCodeBitmap(modules)
    // A 25-module code and its 4-module quiet zone on each side, at 18 pixels a module, about 600 pixels wide.
    expect(modules).toHaveLength(25)
    expect([width, height]).toEqual([594, 594])
    const pixel = (x: number, y: number) => [...data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)]
    modules.forEach((row, y) => row.forEach((dark, x) => {
      const centre = pixel((x + 4) * 18 + 9, (y + 4) * 18 + 9)
      expect(centre, `module ${x},${y}`).toEqual(dark ? [0, 0, 0, 255] : [255, 255, 255, 255])
    }))
    // The quiet zone is white all round, and a module's square has no gap at its edges.
    for (const [x, y] of [[0, 0], [71, 300], [522, 522], [593, 593]]) expect(pixel(x!, y!)).toEqual([255, 255, 255, 255])
    expect(modules[0]![0]).toBe(true)
    expect(pixel(72, 72)).toEqual([0, 0, 0, 255])
    expect(pixel(89, 89)).toEqual([0, 0, 0, 255])
  })

  it('keeps a module at least three pixels wide for the largest code', () => {
    const modules = qrCode('x'.repeat(2331))!
    expect(modules).toHaveLength(177)
    expect(qrCodeBitmap(modules).width).toBe((177 + 8) * 3)
  })

  it('makes a PNG of the text\'s code, or none for text longer than a QR code holds', () => {
    expect(qrCodePng('https://hronaut.dev/')?.subarray(0, 8).toString()).toBe('594x594:')
    expect(qrCodePng('x'.repeat(2332))).toBeUndefined()
  })

  it('names the image after the address\'s host, as Chrome does, and after Hronaut without a host name', () => {
    expect(qrCodeFilename('https://hronaut.dev/guide?x=1#top')).toBe('qrcode_hronaut.dev.png')
    expect(qrCodeFilename('https://xn--bcher-kva.example/')).toBe('qrcode_xn--bcher-kva.example.png')
    expect(qrCodeFilename('http://127.0.0.1:8080/')).toBe('qrcode_hronaut.png')
    expect(qrCodeFilename('http://[::1]:3000/')).toBe('qrcode_hronaut.png')
    expect(qrCodeFilename('not an address')).toBe('qrcode_hronaut.png')
    expect(qrCodeFilename('data:text/plain,hi')).toBe('qrcode_hronaut.png')
  })
})
