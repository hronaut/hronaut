/**
 * Runs in Hronaut's own isolated world of the page: leaves the document's full screen. Electron reports a page's full
 * screen before the document shows it, so a document not in full screen yet waits up to 2 seconds for it.
 */
export function exitFullscreenInPage(): Promise<boolean> {
  return new Promise((resolve) => {
    const leave = (): Promise<void> => document.exitFullscreen().then(() => resolve(true), () => resolve(false))
    if (document.fullscreenElement) return leave()
    document.addEventListener('fullscreenchange', () => document.fullscreenElement ? leave() : resolve(false), { once: true })
    setTimeout(() => resolve(false), 2000)
  })
}
