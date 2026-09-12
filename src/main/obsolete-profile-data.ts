import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'

const STORAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Discard obsolete browser storage before any Chromium session opens it. */
export async function discardObsoleteBrowserData(profileDirectory: string): Promise<void> {
  await rm(join(profileDirectory, 'Partitions', 'hronaut'), { recursive: true, force: true })
  const path = join(profileDirectory, 'tabs.json')
  let value: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    value = parsed as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return
    throw error
  }
  if (value.version !== undefined && value.version !== 0 && value.version !== 1 && value.version !== 2) return
  for (const groups of [value.mcpTabGroups, value.savedTabGroups]) {
    if (!Array.isArray(groups)) continue
    for (const group of groups) {
      const id: unknown = group?.storageId
      if (typeof id !== 'string' || !STORAGE_ID.test(id)) continue
      await rm(join(profileDirectory, 'Partitions', `hronaut-workspace-${id.toLowerCase()}`), { recursive: true, force: true })
    }
  }
  await rm(path, { force: true })
}
