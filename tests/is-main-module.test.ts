import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isMainModule } from '../scripts/is-main-module.js'

let directory: string
let file: string
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hronaut-entrypoint-'))
  file = join(directory, 'script.mjs')
  await writeFile(file, '')
})
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

describe('script entrypoint detection', () => {
  it('recognizes absolute and relative direct execution', () => {
    expect(isMainModule(pathToFileURL(file).href, file)).toBe(true)
    expect(isMainModule(pathToFileURL(file).href, relative(process.cwd(), file))).toBe(true)
  })

  it('recognizes both real and preserved module paths through a directory alias', async () => {
    const real = join(directory, 'real')
    const alias = join(directory, 'alias')
    await mkdir(real)
    const target = join(real, 'script.mjs')
    await writeFile(target, '')
    await symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const invoked = join(alias, 'script.mjs')
    expect(isMainModule(pathToFileURL(target).href, invoked)).toBe(true)
    expect(isMainModule(pathToFileURL(invoked).href, target)).toBe(true)
  })

  it('does not run an imported module', async () => {
    const entry = join(directory, 'entry.mjs')
    await writeFile(entry, '')
    expect(isMainModule(pathToFileURL(file).href, entry)).toBe(false)
  })

  it('ignores missing entrypoints and non-file module URLs', () => {
    expect(isMainModule(pathToFileURL(file).href, '')).toBe(false)
    expect(isMainModule(pathToFileURL(file).href, join(directory, 'missing'))).toBe(false)
    expect(isMainModule('data:text/javascript,export default 1', file)).toBe(false)
  })
})
