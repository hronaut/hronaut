import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Seed a real version-2 base-partition owner before launching an explicit migration test. */
export async function seedLegacyWorkspaceProfile(profileDirectory: string): Promise<{ workspaceId: string; homeTabId: string }> {
  const workspaceId = '01912345-6789-7abc-8def-0123456789ab'
  const homeTabId = '01912345-678c-7abc-8def-0123456789ab'
  await mkdir(profileDirectory, { recursive: true })
  await writeFile(join(profileDirectory, 'tabs.json'), JSON.stringify({
    version: 2,
    activeTabId: homeTabId,
    defaultHumanGroupId: workspaceId,
    allHumanInteractionLocked: false,
    mcpTabGroups: [{
      id: workspaceId, name: 'Default', color: 'gray',
      createdAt: '2026-09-07T00:00:00.000Z', lastUsedAt: '2026-09-07T00:00:00.000Z',
      activeTabId: null, origins: [], navigationPolicy: { mode: 'unrestricted', rules: [] }, navigationAudit: []
    }],
    savedTabGroups: [],
    tabs: [{ id: homeTabId, title: 'Hronaut Home', url: 'hronaut://home/' }]
  }), 'utf8')
  return { workspaceId, homeTabId }
}
