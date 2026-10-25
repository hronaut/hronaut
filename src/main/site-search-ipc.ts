import { randomUUID } from 'node:crypto'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { LocalizedError } from './localized-error.js'
import {
  SITE_SEARCH_LIMIT,
  isSiteSearchDraft,
  isSiteSearchId,
  siteSearchFromDraft,
  siteSearchProblems,
  type SiteSearch,
  type SiteSearchDraft
} from '../shared/site-search.js'
import type { AppSettings } from '../shared/types.js'

interface SiteSearchIpcHost {
  assertTrustedSender(event: IpcMainInvokeEvent): void
  /** The current settings; read on every use because each committed update replaces the object. */
  settings(): AppSettings
  updateSettings(updates: Partial<AppSettings>): Promise<AppSettings>
  publishSettings(): void
}

/**
 * Settings' Site search list, as in Chrome: add, edit and delete the shortcuts that search a site from the address
 * bar. Main checks each change with the rules the form shows (site-search.ts), and makes the changes one after
 * another, each from the list the one before it saved, so that two quick changes both stay.
 */
export function registerSiteSearchIpc(ipcMain: Pick<IpcMain, 'handle'>, host: SiteSearchIpcHost): void {
  let changes: Promise<unknown> = Promise.resolve()

  function change(edit: (current: readonly SiteSearch[]) => SiteSearch[]): Promise<AppSettings> {
    const operation = changes.then(async () => {
      await host.updateSettings({ siteSearches: edit(host.settings().siteSearches) })
      host.publishSettings()
      return { ...host.settings() }
    })
    changes = operation.catch(() => undefined)
    return operation
  }

  function checked(id: string, draft: SiteSearchDraft, others: readonly SiteSearch[]): SiteSearch {
    if (Object.keys(siteSearchProblems(draft, others)).length) throw new LocalizedError('appErrors.settings.siteSearchRejected')
    return siteSearchFromDraft(id, draft)
  }

  ipcMain.handle('settings:add-site-search', (event, draft: unknown) => {
    host.assertTrustedSender(event)
    if (!isSiteSearchDraft(draft)) throw new TypeError('Invalid site search')
    return change((current) => {
      if (current.length >= SITE_SEARCH_LIMIT) throw new LocalizedError('appErrors.settings.siteSearchRejected')
      return [...current, checked(randomUUID(), draft, current)]
    })
  })
  ipcMain.handle('settings:update-site-search', (event, id: unknown, draft: unknown) => {
    host.assertTrustedSender(event)
    if (!isSiteSearchId(id) || !isSiteSearchDraft(draft)) throw new TypeError('Invalid site search')
    return change((current) => {
      if (!current.some((entry) => entry.id === id)) throw new LocalizedError('appErrors.settings.siteSearchMissing')
      const others = current.filter((entry) => entry.id !== id)
      const updated = checked(id, draft, others)
      return current.map((entry) => entry.id === id ? updated : entry)
    })
  })
  ipcMain.handle('settings:remove-site-search', (event, id: unknown) => {
    host.assertTrustedSender(event)
    if (!isSiteSearchId(id)) throw new TypeError('Invalid site search')
    // A site search another window deleted first is gone already, as it should be.
    return change((current) => current.filter((entry) => entry.id !== id))
  })
}
