import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { TabStateStore } from './browser/tab-store.js'

/** Only accepted current metadata can authorize removal of the obsolete shared
 * partition. Rejected legacy snapshots and all their storage remain untouched. */
export async function discardObsoleteBrowserData(profileDirectory: string): Promise<boolean> {
  const saved = await new TabStateStore(join(profileDirectory, 'tabs.json')).load({ persistRepairs: false })
  if (!saved) return false
  await rm(join(profileDirectory, 'Partitions', 'hronaut'), { recursive: true, force: true })
  return true
}
