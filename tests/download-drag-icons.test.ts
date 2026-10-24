import type { NativeImage } from 'electron'
import { expect, it, vi } from 'vitest'
import { DownloadDragIcons } from '../src/main/browser/download-drag-icons.js'

vi.mock('electron', () => ({
  app: { getFileIcon: vi.fn() },
  nativeImage: {
    createFromBitmap: vi.fn((pixels: Buffer, size: { width: number; height: number }) => ({ plain: true, pixels, size, isEmpty: () => false }))
  }
}))

const systemIcon = (empty = false) => ({ system: true, isEmpty: () => empty }) as unknown as NativeImage

it('reads each finished file\'s icon once, and keeps the files asked about last', async () => {
  const { app } = await import('electron')
  vi.mocked(app.getFileIcon).mockReset().mockImplementation(async () => systemIcon())
  const icons = new DownloadDragIcons()
  const first = icons.icon('/downloads/report.txt')
  expect(icons.icon('/downloads/report.txt')).toBe(first)
  await expect(first).resolves.toEqual(expect.objectContaining({ system: true }))
  expect(app.getFileIcon).toHaveBeenCalledExactlyOnceWith('/downloads/report.txt', { size: 'normal' })
  // 32 newer files: report.txt, asked about again among them, keeps its icon, and the oldest of the others is read again.
  for (let index = 0; index < 32; index += 1) {
    void icons.icon(`/downloads/${index}.bin`)
    if (index === 16) void icons.icon('/downloads/report.txt')
  }
  expect(app.getFileIcon).toHaveBeenCalledTimes(33)
  void icons.icon('/downloads/report.txt')
  expect(app.getFileIcon).toHaveBeenCalledTimes(33)
  void icons.icon('/downloads/0.bin')
  expect(app.getFileIcon).toHaveBeenCalledTimes(34)
})

it('drags a plain page for a file the system has no icon for, never an empty image, which macOS refuses', async () => {
  const { app, nativeImage } = await import('electron')
  vi.mocked(app.getFileIcon).mockReset()
    .mockRejectedValueOnce(new Error('Failed to get file icon.'))
    .mockResolvedValueOnce(systemIcon(true))
  const icons = new DownloadDragIcons()
  for (const path of ['/downloads/no-theme.bin', '/downloads/empty.bin']) {
    const icon = await icons.icon(path) as unknown as { plain: boolean; pixels: Buffer; size: { width: number; height: number } }
    expect(icon.plain).toBe(true)
    expect(icon.size).toEqual({ width: 32, height: 32 })
    const pixel = (x: number, y: number) => [...icon.pixels.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)]
    // An opaque grey page with a darker edge, on a clear ground.
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
    expect(pixel(6, 2)).toEqual([0x80, 0x80, 0x80, 0xff])
    expect(pixel(16, 16)).toEqual([0xf4, 0xf4, 0xf4, 0xff])
  }
  expect(nativeImage.createFromBitmap).toHaveBeenCalledTimes(2)
})
