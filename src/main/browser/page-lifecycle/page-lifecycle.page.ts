/** An animation's time and playback rate before freezing paused it. */
export interface HeldAnimation {
  currentTime: unknown
  playbackRate: number
}

/** Runs in the page: pauses up to maxCount of its animations and returns each one's time and playback rate, or none. */
export function holdPageAnimationsInPage(maxCount: number): HeldAnimation[] {
  try {
    return Array.from(document.getAnimations()).slice(0, maxCount).map(animation => {
      const record = {
        currentTime: animation.currentTime,
        playbackRate: animation.playbackRate
      }
      animation.playbackRate = 0
      return record
    })
  } catch { return [] }
}

/** Runs in the page: gives its animations, in order, the times and playback rates freezing held. */
export function restorePageAnimationsInPage(records: Array<{ currentTime: number | null; playbackRate: number }>): void {
  try {
    const animations = Array.from(document.getAnimations())
    for (let index = 0; index < records.length; index += 1) {
      const animation = animations[index]
      if (!animation) continue
      animation.playbackRate = records[index]!.playbackRate
      animation.currentTime = records[index]!.currentTime
    }
  } catch { /* Animation restoration is best effort for adversarial pages. */ }
}
