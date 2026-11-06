import { computed, ref } from 'vue'
import { SITE_SOUND_PERMISSION } from '../../../../shared/site-permission-names.js'
import type { BrowserTabState } from '../../../../shared/types.js'

/** The tab shown, as far as which of its documents it shows. */
type ShownPage = Pick<BrowserTabState, 'id' | 'documentGeneration'>

/**
 * A permission changed in Site controls applies to what the page asks for next, while a page already using it, such as
 * its camera or its location, goes on until it loads again. So, as Chrome's site information does, Site controls then
 * offer to reload the page, for as long as the tab shows the same document. Muting a site's sound applies at once.
 */
export function usePermissionReloadOffer(activeTab: () => ShownPage | undefined) {
  const changedIn = ref<{ tabId: string; documentGeneration: number | undefined } | null>(null)

  function shows(tab: ShownPage | undefined, page: { tabId: string; documentGeneration: number | undefined }): boolean {
    return tab?.id === page.tabId && tab.documentGeneration === page.documentGeneration
  }

  /**
   * Changes a permission of the page shown, then offers to reload that page if it still shows: one that went on to
   * another document meanwhile has the new settings, and its change does not take the offer from a later change.
   */
  async function change(permission: string, run: () => boolean | Promise<boolean>): Promise<boolean> {
    const tab = activeTab()
    const page = tab ? { tabId: tab.id, documentGeneration: tab.documentGeneration } : null
    const changed = await run()
    if (changed && page && permission !== SITE_SOUND_PERMISSION && shows(activeTab(), page)) changedIn.value = page
    return changed
  }

  const offered = computed(() => changedIn.value !== null && shows(activeTab(), changedIn.value))

  /** The tab to reload, while the offer stands, which then ends. */
  function accept(): string | undefined {
    const page = changedIn.value
    changedIn.value = null
    return page && shows(activeTab(), page) ? page.tabId : undefined
  }

  return { change, offered, accept }
}
