import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Seed a current isolated human workspace for storage and shutdown tests. */
export async function seedWorkspaceProfile(profileDirectory: string): Promise<{ workspaceId: string; homeTabId: string }> {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const homeTabId = '01912345-678c-7abc-8def-0123456789ab'
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(join(profileDirectory, 'tabs.json'), JSON.stringify({
    version: 3,
    activeTabId: homeTabId,
    allHumanInteractionLocked: false,
    mcpTabGroups: [{
      id: workspaceId, name: 'Personal', color: 'gray',
      storageId: '77777777-1111-4111-8111-111111111111',
      createdAt: '2026-09-07T00:00:00.000Z', lastUsedAt: '2026-09-07T00:00:00.000Z',
      activeTabId: null, origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: []
    }],
    savedTabGroups: [],
    tabs: [{ id: homeTabId, title: 'Hronaut Home', url: 'hronaut://home/' }]
  }), 'utf8')
  return { workspaceId, homeTabId }
}
