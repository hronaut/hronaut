import { nativeImage, WebContentsView, type NativeImage, type WebContents } from 'electron'

/** Decodes an image as a 32 pixel PNG data URL, or answers null. */
export interface FaviconImageDecoder {
  decodeImage(source: string): Promise<unknown>
}

export async function decodeWebsiteFavicon(
  bytes: Buffer,
  mimeType: string,
  decoder: FaviconImageDecoder
): Promise<NativeImage> {
  const native = nativeImage.createFromBuffer(bytes)
  if (!native.isEmpty()) return native

  // Chromium supports website icon formats (including SVG and ICO) that
  // nativeImage cannot decode on every platform. Decode only an image, never
  // SVG markup or scripts in a document.
  const type = bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
    ? 'image/x-icon'
    : mimeType.split(';')[0]!.trim().toLowerCase()
  if (!/^image\/(svg\+xml|x-icon|vnd\.microsoft\.icon|webp|gif|avif)$/.test(type)) return native
  const result = await decoder.decodeImage(`data:${type};base64,${bytes.toString('base64')}`)
  return typeof result === 'string' && result.length <= 32 * 1024 && result.startsWith('data:image/png;base64,')
    ? nativeImage.createFromDataURL(result)
    : native
}

/** How long the decoding page stays after its last icon, for the icons of the other pages loading meanwhile. */
export const FAVICON_DECODER_IDLE_MS = 30_000

/**
 * Decodes the website icons Electron's own decoder cannot, one at a time, in a page of its own: not in Hronaut's
 * window, which draws the tabs while many pages load at once and should never take a website's image. The page holds
 * nothing else, has its own empty session, and closes once no icon came for a while.
 */
export class FaviconDecoder implements FaviconImageDecoder {
  private page: Promise<WebContents> | undefined
  private contents: WebContents | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private idleTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  decodeImage(source: string): Promise<unknown> {
    const decoded = this.queue.then(() => this.decodeNow(source))
    this.queue = decoded.catch(() => undefined)
    return decoded
  }

  dispose(): void {
    this.disposed = true
    this.close()
  }

  private async decodeNow(source: string): Promise<unknown> {
    if (this.disposed) return null
    clearTimeout(this.idleTimer)
    try {
      const contents = await this.openPage()
      return await contents.executeJavaScript(`new Promise((resolve) => {
        const image = new Image(32, 32);
        const finish = (result) => {
          clearTimeout(timer);
          image.onload = image.onerror = null;
          image.src = '';
          resolve(result);
        };
        const timer = setTimeout(() => finish(null), 5000);
        image.onerror = () => finish(null);
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 32;
            canvas.getContext('2d').drawImage(image, 0, 0, 32, 32);
            finish(canvas.toDataURL('image/png'));
          } catch { finish(null); }
        };
        image.src = ${JSON.stringify(source)};
      })`, false)
    } finally {
      if (!this.disposed) {
        this.idleTimer = setTimeout(() => this.close(), FAVICON_DECODER_IDLE_MS)
        this.idleTimer.unref?.()
      }
    }
  }

  private openPage(): Promise<WebContents> {
    if (this.page && this.contents && !this.contents.isDestroyed()) return this.page
    const view = new WebContentsView({
      webPreferences: {
        partition: 'hronaut-favicon-decoder',
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        spellcheck: false,
        webgl: false
      }
    })
    const contents = view.webContents
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    contents.on('will-navigate', (event) => event.preventDefault())
    // A decoding page that stopped working is replaced by the next icon's.
    contents.once('render-process-gone', () => { if (this.contents === contents) this.close() })
    this.contents = contents
    this.page = contents.loadURL('about:blank').then(() => contents)
    return this.page
  }

  private close(): void {
    clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const contents = this.contents
    this.contents = undefined
    this.page = undefined
    if (contents && !contents.isDestroyed()) contents.close()
  }
}
