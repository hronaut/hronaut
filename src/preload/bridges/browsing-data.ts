import type { BrowsingDataClearOptions, HronautBrowsingDataApi } from '../../shared/types.js'
import { BROWSING_DATA_IPC } from '../../shared/ipc/browsing-data.js'
import { invoke } from './ipc.js'

/** window.hronautBrowsingData: what Hronaut keeps of the person's browsing. */
export const browsingDataApi: HronautBrowsingDataApi = {
  summary: () => invoke(BROWSING_DATA_IPC.summary),
  siteSummary: (url: string, tabId: string) => invoke(BROWSING_DATA_IPC.siteSummary, url, tabId),
  websites: () => invoke(BROWSING_DATA_IPC.websites),
  clear: (options: BrowsingDataClearOptions) => invoke(BROWSING_DATA_IPC.clear, options)
}
