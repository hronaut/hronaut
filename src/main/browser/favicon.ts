import { nativeImage, type NativeImage, type WebContents } from 'electron'

const FAVICON_DECODER_WORLD_ID = 1100

export async function decodeWebsiteFavicon(
  bytes: Buffer,
  mimeType: string,
  trustedShell: WebContents
): Promise<NativeImage> {
  const native = nativeImage.createFromBuffer(bytes)
  if (!native.isEmpty()) return native

  // Chromium supports website icon formats (including SVG and ICO) that
  // nativeImage cannot decode on every platform. Decode only an image in the
  // trusted shell, never SVG markup or scripts in the website's document.
  const type = bytes.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0]))
    ? 'image/x-icon'
    : mimeType.split(';')[0]!.trim().toLowerCase()
  if (!/^image\/(svg\+xml|x-icon|vnd\.microsoft\.icon|webp|gif|avif)$/.test(type)) return native
  const source = `data:${type};base64,${bytes.toString('base64')}`
  const result: unknown = await trustedShell.executeJavaScriptInIsolatedWorld(FAVICON_DECODER_WORLD_ID, [{
    code: `new Promise((resolve) => {
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
    })`
  }], false)
  return typeof result === 'string' && result.length <= 32 * 1024 && result.startsWith('data:image/png;base64,')
    ? nativeImage.createFromDataURL(result)
    : native
}
