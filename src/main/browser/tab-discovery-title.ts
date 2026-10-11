import type { NavigationEntry } from 'electron'
import { normalizeTabTitle } from './tab-metadata.js'

export const MAX_RESTORED_DISCOVERY_TITLES = 50

/** Electron can report restored GetTitleForDisplay() URL fallbacks as explicit titles. */
export class TabDiscoveryTitle {
  value = ''
  private readonly restoredTitles = new Set<string>()
  private saturated = false

  clear(): void {
    this.value = ''
  }

  restoring(entries: readonly NavigationEntry[]): void {
    this.clear()
    if (this.saturated) return
    for (const entry of entries) {
      if (!entry.title?.trim()) continue
      this.restoredTitles.add(normalizeTabTitle(entry.title))
      if (this.restoredTitles.size > MAX_RESTORED_DISCOVERY_TITLES) {
        // Never forget an old unverified title merely to admit a newer one.
        this.restoredTitles.clear()
        this.saturated = true
        return
      }
    }
  }

  observe(title: string, explicitSet: boolean): void {
    const normalized = title.trim() ? normalizeTabTitle(title) : ''
    this.value = explicitSet && !this.saturated && !this.restoredTitles.has(normalized) ? normalized : ''
  }
}
