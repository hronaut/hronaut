import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { seedPackagedMcpSmokeProfile } from '../scripts/packaged-mcp-smoke-profile.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('packaged MCP smoke profile', () => {
  it('explicitly selects the Complete catalog expected by the smoke assertions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'hronaut-packaged-smoke-profile-test-'))
    directories.push(directory)

    await seedPackagedMcpSmokeProfile(directory)

    expect(JSON.parse(await readFile(join(directory, 'settings.json'), 'utf8'))).toEqual({
      mcpToolSet: 'complete'
    })
  })
})
