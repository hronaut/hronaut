import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { closeHronaut, expect, launchHronaut, test } from './fixtures.js'

test('waits for Default and isolated browser profiles to flush before exiting', async ({
  profileDirectory,
  mcpPort
}) => {
  const markerPath = join(profileDirectory, 'profile-flush-marker.txt')
  const instance = await launchHronaut(profileDirectory, mcpPort)
  const child = instance.app.process()

  try {
    const archivedState = await instance.window.evaluate(`window.hronaut.createWorkspace({
      name: 'Shutdown archived',
      color: 'cyan',
      storage: 'scratch'
    })`) as { mcpTabGroups: Array<{ id: string; name: string }> }
    const archivedWorkspaceId = archivedState.mcpTabGroups.find((workspace) => workspace.name === 'Shutdown archived')?.id
    if (!archivedWorkspaceId) throw new Error('Archived shutdown workspace was not created')
    await instance.window.evaluate(`window.hronaut.saveAndCloseTabGroup(${JSON.stringify(archivedWorkspaceId)})`)
    await instance.window.evaluate(`window.hronaut.createWorkspace({
      name: 'Shutdown active',
      color: 'green',
      storage: 'scratch'
    })`)
    const tabsPath = join(profileDirectory, 'tabs.json')
    await expect.poll(async () => {
      try {
        const persisted = JSON.parse(await readFile(tabsPath, 'utf8')) as {
          mcpTabGroups?: Array<{ name?: string; storageId?: string }>
          savedTabGroups?: Array<{ name?: string; storageId?: string }>
        }
        return [
          persisted.mcpTabGroups?.find((workspace) => workspace.name === 'Shutdown active')?.storageId ?? '',
          persisted.savedTabGroups?.find((workspace) => workspace.name === 'Shutdown archived')?.storageId ?? ''
        ]
      } catch {
        return []
      }
    }).toEqual([
      expect.stringMatching(/^[0-9a-f-]{36}$/),
      expect.stringMatching(/^[0-9a-f-]{36}$/)
    ])
    const persisted = JSON.parse(await readFile(tabsPath, 'utf8')) as {
      mcpTabGroups: Array<{ name: string; storageId?: string }>
      savedTabGroups: Array<{ name: string; storageId?: string }>
    }
    const activeStorageId = persisted.mcpTabGroups.find((workspace) => workspace.name === 'Shutdown active')?.storageId
    const archivedStorageId = persisted.savedTabGroups.find((workspace) => workspace.name === 'Shutdown archived')?.storageId
    if (!activeStorageId || !archivedStorageId) throw new Error('Isolated workspace storage IDs were not persisted')

    await instance.app.evaluate(({ app, session }, input) => {
      const { appendFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
      for (const profile of input.profiles) {
        const browserSession = session.fromPartition(profile.partition, { cache: true })
        const originalFlush = browserSession.flushStorageData.bind(browserSession)
        browserSession.flushStorageData = async () => {
          appendFileSync(input.marker, `${profile.label}-started\n`)
          await new Promise((resolve) => setTimeout(resolve, profile.delayMs))
          await originalFlush()
          appendFileSync(input.marker, `${profile.label}-finished\n`)
        }
      }
      setImmediate(() => app.quit())
    }, {
      marker: markerPath,
      profiles: [
        { label: 'default', partition: 'persist:hronaut', delayMs: 200 },
        {
          label: 'active',
          partition: `persist:hronaut-workspace-${activeStorageId}`,
          delayMs: 600
        },
        {
          label: 'archived',
          partition: `persist:hronaut-workspace-${archivedStorageId}`,
          delayMs: 1_000
        }
      ]
    })

    if (child.exitCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.off('exit', onExit)
          reject(new Error('Hronaut did not exit after flushing its persistent browser profile'))
        }, 5_000)
        const onExit = (): void => {
          clearTimeout(timer)
          resolve()
        }
        child.once('exit', onExit)
      })
    }

    expect((await readFile(markerPath, 'utf8')).trim().split('\n').sort()).toEqual([
      'active-finished',
      'active-started',
      'archived-finished',
      'archived-started',
      'default-finished',
      'default-started'
    ])
  } finally {
    await closeHronaut(instance.app)
  }
})
