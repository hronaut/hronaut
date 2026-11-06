/**
 * Runs in the favicon decoder's own page: draws the image at this address at 32 by 32 pixels, or at its own size when
 * smaller, and gives it as a PNG data URL, or null when it does not load in 5 seconds or cannot be drawn. An SVG, sharp
 * at any size, is drawn at 32; a smaller icon keeps its size so the tab can prefer a larger one it would not scale up.
 */
export function decodeFaviconInPage(source: string): Promise<string | null> {
  return new Promise((resolve) => {
    const image = new Image(32, 32)
    const finish = (result: string | null): void => {
      clearTimeout(timer)
      image.onload = image.onerror = null
      image.src = ''
      resolve(result)
    }
    const timer = setTimeout(() => finish(null), 5000)
    image.onerror = () => finish(null)
    image.onload = () => {
      try {
        const size = source.startsWith('data:image/svg+xml') ? 32 : Math.min(32, image.naturalWidth, image.naturalHeight) || 32
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        canvas.getContext('2d')!.drawImage(image, 0, 0, size, size)
        finish(canvas.toDataURL('image/png'))
      } catch { finish(null) }
    }
    image.src = source
  })
}
