/**
 * Runs in Hronaut's own isolated world of the page: leaves the document's full screen. Electron reports a page's full
 * screen before the document shows it, so a document not in full screen yet waits up to 2 seconds for it. A
 * fullscreenchange event that finds no element in full screen, which can come first once a page out of view is shown,
 * is passed over.
 */
export function exitFullscreenInPage(): Promise<boolean> {
  return new Promise((resolve) => {
    const leave = (): Promise<void> => document.exitFullscreen().then(() => resolve(true), () => resolve(false))
    if (document.fullscreenElement) return leave()
    const entered = (): void => {
      if (!document.fullscreenElement) return
      document.removeEventListener('fullscreenchange', entered)
      void leave()
    }
    document.addEventListener('fullscreenchange', entered)
    setTimeout(() => {
      document.removeEventListener('fullscreenchange', entered)
      resolve(false)
    }, 2000)
  })
}
