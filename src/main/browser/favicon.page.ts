/**
 * Runs in the favicon decoder's own page: draws the image at this address at 32 by 32 pixels and gives it as a PNG
 * data URL, or null when it does not load in 5 seconds or cannot be drawn.
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
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 32
        canvas.getContext('2d')!.drawImage(image, 0, 0, 32, 32)
        finish(canvas.toDataURL('image/png'))
      } catch { finish(null) }
    }
    image.src = source
  })
}
