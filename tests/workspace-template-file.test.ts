import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readWorkspaceTemplateFile, writeWorkspaceTemplateFile } from '../src/main/workspace-template-file.js'
import { WORKSPACE_TEMPLATE_MAX_BYTES } from '../src/shared/workspace-template.js'

const directories: string[] = []
async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hronaut-template-test-'))
  directories.push(directory)
  return directory
}
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })
const manifest = JSON.stringify({ format: 'hronaut-workspace-template', version: 1, sourcePlatform: 'linux', workspaces: [{ name: 'Demo', color: 'blue', startPages: [] }] })

describe('workspace template file boundary', () => {
  it('round trips only validated metadata with owner-only export permissions', async () => {
    const path = join(await fixture(), 'template.json')
    await writeWorkspaceTemplateFile(path, manifest)
    expect(JSON.parse(await readWorkspaceTemplateFile(path))).toEqual(JSON.parse(manifest))
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })
  it('does not overwrite an existing file when validation fails', async () => {
    const path = join(await fixture(), 'template.json')
    await writeFile(path, 'existing contents')
    await expect(writeWorkspaceTemplateFile(path, '{')).rejects.toThrow('JSON')
    expect(await readFile(path, 'utf8')).toBe('existing contents')
  })
  it('rejects oversized input and invalid UTF-8', async () => {
    const path = join(await fixture(), 'template.json')
    await writeFile(path, Buffer.alloc(WORKSPACE_TEMPLATE_MAX_BYTES + 1, 32))
    await expect(readWorkspaceTemplateFile(path)).rejects.toThrow('size limit')
    await writeFile(path, Buffer.from([0xff, 0xfe]))
    await expect(readWorkspaceTemplateFile(path)).rejects.toThrow('UTF-8')
  })
  it('rejects a directory without treating it as a template', async () => {
    await expect(readWorkspaceTemplateFile(await fixture())).rejects.toThrow()
  })
})
