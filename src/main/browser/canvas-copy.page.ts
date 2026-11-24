/**
 * Whether the canvas at (x, y) in the page, looked up through frames of the same document's site, shows another
 * website's picture, which the page may not read. Chromium's Copy Image gives no picture for such a canvas, as Chrome
 * does, and the clipboard would otherwise keep whatever was copied before. One pixel is drawn into a scratch canvas
 * and read back, which throws for a canvas another site's picture taints, without encoding the whole canvas.
 */
export function canvasAtPointInPage(x: number, y: number): 'readable' | 'tainted' | 'none' {
  let doc: Document = document
  let left = x
  let top = y
  for (let depth = 0; depth < 16; depth += 1) {
    const element = doc.elementFromPoint(left, top)
    if (!element) return 'none'
    const tag = element.tagName.toLowerCase()
    if (tag === 'iframe' || tag === 'frame') {
      const frame = element as HTMLIFrameElement
      const inner = frame.contentDocument
      if (!inner) return 'none'
      const box = frame.getBoundingClientRect()
      left -= box.left + frame.clientLeft
      top -= box.top + frame.clientTop
      doc = inner
      continue
    }
    if (tag !== 'canvas') return 'none'
    const canvas = element as HTMLCanvasElement
    if (canvas.width === 0 || canvas.height === 0) return 'readable'
    const scratch = doc.createElement('canvas')
    scratch.width = 1
    scratch.height = 1
    const context = scratch.getContext('2d')
    if (!context) return 'readable'
    try {
      context.drawImage(canvas, 0, 0, 1, 1, 0, 0, 1, 1)
      context.getImageData(0, 0, 1, 1)
      return 'readable'
    } catch (error) {
      return error instanceof DOMException && error.name === 'SecurityError' ? 'tainted' : 'readable'
    }
  }
  return 'none'
}
