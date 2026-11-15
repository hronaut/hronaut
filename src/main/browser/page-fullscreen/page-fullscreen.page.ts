/**
 * Runs in Hronaut's own isolated world of the page: leaves the document's full screen. Electron reports a page's full
 * screen before the document shows it, so a document not in full screen yet waits up to 2 seconds for it. A
 * fullscreenchange event that finds no element in full screen, which can come first once a page out of view is shown,
 * is passed over. An element a page put in full screen inside another, such as a video inside a player already in full
 * screen, leaves only itself, so the document leaves one element at a time, up to 16, until none is left.
 */
export function exitFullscreenInPage(): Promise<boolean> {
  return new Promise((resolve) => {
    const leave = async (levelsLeft: number): Promise<void> => {
      try {
        await document.exitFullscreen()
      } catch {
        resolve(false)
        return
      }
      if (!document.fullscreenElement) resolve(true)
      else if (levelsLeft > 1) await leave(levelsLeft - 1)
      else resolve(false)
    }
    if (document.fullscreenElement) return leave(16)
    const entered = (): void => {
      if (!document.fullscreenElement) return
      document.removeEventListener('fullscreenchange', entered)
      void leave(16)
    }
    document.addEventListener('fullscreenchange', entered)
    setTimeout(() => {
      document.removeEventListener('fullscreenchange', entered)
      resolve(false)
    }, 2000)
  })
}
