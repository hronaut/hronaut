import { app, nativeImage, type NativeImage } from 'electron'

/** Enough for the files a person drags soon after they finish, without keeping an icon for every download. */
const KEPT_ICONS = 32
const PAGE_SIZE = 32

/**
 * A plain page, for a file the system has no icon for: a drag needs an image under the pointer, and macOS refuses an
 * empty one. Its greys read the same in any channel order.
 */
function plainPageIcon(): NativeImage {
  const pixels = Buffer.alloc(PAGE_SIZE * PAGE_SIZE * 4)
  for (let y = 2; y < PAGE_SIZE - 2; y += 1) {
    for (let x = 6; x < PAGE_SIZE - 6; x += 1) {
      const offset = (y * PAGE_SIZE + x) * 4
      const edge = y === 2 || y === PAGE_SIZE - 3 || x === 6 || x === PAGE_SIZE - 7
      pixels.fill(edge ? 0x80 : 0xf4, offset, offset + 3)
      pixels[offset + 3] = 0xff
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: PAGE_SIZE, height: PAGE_SIZE })
}

/** The system's icon for a file, or a plain page when it has none for it. */
async function readIcon(path: string): Promise<NativeImage> {
  try {
    const icon = await app.getFileIcon(path, { size: 'normal' })
    if (!icon.isEmpty()) return icon
  } catch {
    // No icon theme, or none for this kind of file.
  }
  return plainPageIcon()
}

/**
 * Icons for finished downloads, read when each one finishes, so a drag out of Downloads starts while the person still
 * holds the pointer, as Chrome's downloads page shows each file's icon before it can be dragged.
 */
export class DownloadDragIcons {
  private readonly icons = new Map<string, Promise<NativeImage>>()

  /** The icon for a finished file, read once; the files asked about last keep theirs. */
  icon(path: string): Promise<NativeImage> {
    const icon = this.icons.get(path) ?? readIcon(path)
    this.icons.delete(path)
    this.icons.set(path, icon)
    for (const oldest of this.icons.keys()) {
      if (this.icons.size <= KEPT_ICONS) break
      this.icons.delete(oldest)
    }
    return icon
  }
}
