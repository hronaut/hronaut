import type { BrowsingDataClearOptions, BrowsingDataSiteSummary, BrowsingDataSummary, BrowsingDataWebsiteSummary } from '../types.js'
import type { InvokeChannel } from './channel.js'

/** What Hronaut keeps of the person's browsing, for Clear browsing data and a site's data. */
export const BROWSING_DATA_IPC = {
  /** Shell → main: how much of each kind of browsing data is kept. */
  summary: 'browsing-data:summary' as InvokeChannel<[], BrowsingDataSummary>,
  /** Shell → main: what one website keeps, for the tab showing it. */
  siteSummary: 'browsing-data:site-summary' as InvokeChannel<[url: string, tabId: string], BrowsingDataSiteSummary>,
  /** Shell → main: every website that keeps data. */
  websites: 'browsing-data:websites' as InvokeChannel<[], BrowsingDataWebsiteSummary[]>,
  /** Shell → main: clears the chosen kinds of data, answering with what is kept after. */
  clear: 'browsing-data:clear' as InvokeChannel<[options: BrowsingDataClearOptions], BrowsingDataSummary>
} as const
