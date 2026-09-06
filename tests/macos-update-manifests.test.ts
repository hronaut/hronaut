import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { protectMacUpdateManifest, protectMacUpdateManifests } from '../scripts/macos-update-manifests.js'

// Unmodified Electron 44 cross-pack output from the 1.11.59 compatibility preflight.
const fixture = await readFile(new URL('./fixtures/macos-update/latest-mac.yml', import.meta.url), 'utf8')
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })

function updaterSupports(source: string, release: string): boolean {
  // Exercise the installed updater's real compatibility method, including its fail-open
  // semver handling. Isolate the OS override from Vitest and other tests.
  return execFileSync(process.execPath, ['-e', `
    require('node:os').release = () => process.argv[1];
    const { AppUpdater } = require('electron-updater/out/AppUpdater.js');
    const result = AppUpdater.prototype.checkIfUpdateSupported.call(
      { _logger: { info() {}, warn() {} } }, JSON.parse(process.argv[2]));
    process.stdout.write(JSON.stringify(result));
  `, release, JSON.stringify(parse(source))], { encoding: 'utf8' }) === 'true'
}

describe('macOS release updater protection', () => {
  it('blocks Monterey in the real updater while admitting Ventura and newer', () => {
    expect(updaterSupports(fixture, '21.6.0')).toBe(true)
    const protectedManifest = protectMacUpdateManifest(fixture, '1.11.59')
    expect(updaterSupports(protectedManifest, '21.6.0')).toBe(false)
    for (const release of ['22.0.0', '22.1.0', '23.0.0', '25.0.0']) {
      expect(updaterSupports(protectedManifest, release)).toBe(true)
    }
    expect(parse(protectedManifest)).toEqual({ ...parse(fixture), minimumSystemVersion: '22.0.0' })
  })

  it.each(['21.0.0', '22.0.0', '23.1.0'])('never lowers an existing floor %s', minimum => {
    const result = parse(protectMacUpdateManifest(`${fixture}minimumSystemVersion: '${minimum}'\n`, '1.11.59'))
    expect(result.minimumSystemVersion).toBe(minimum === '21.0.0' ? '22.0.0' : minimum)
  })

  it.each(['[]', 'version: [', `${fixture}version: 1.11.59\n`, fixture.replace('1.11.59', '1.11.58'),
    'version: 1.11.59\nfiles: []\n', `${fixture}minimumSystemVersion: thirteen\n`, `${fixture}minimumSystemVersion: '023.0.0'\n`, `${fixture}minimumSystemVersion: '9999999999999999999.0.0'\n`])('rejects invalid input', source => {
    expect(() => protectMacUpdateManifest(source, '1.11.59')).toThrow()
  })

  it('protects every mac feed only and fails before modifying any file on invalid input', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mac-feeds-'))
    directories.push(directory)
    await expect(protectMacUpdateManifests(directory, '1.11.59')).rejects.toThrow('No macOS')
    for (const name of ['latest-mac.yml', 'latest-mac-arm64.yml', 'latest.yml', 'latest-linux.yml']) {
      await writeFile(join(directory, name), fixture)
    }
    await writeFile(join(directory, 'latest-mac-broken.yml'), 'version: wrong')
    await expect(protectMacUpdateManifests(directory, '1.11.59')).rejects.toThrow()
    expect(await readFile(join(directory, 'latest-mac.yml'), 'utf8')).toBe(fixture)
    await rm(join(directory, 'latest-mac-broken.yml'))
    await protectMacUpdateManifests(directory, '1.11.59')
    for (const name of ['latest-mac.yml', 'latest-mac-arm64.yml']) {
      expect(parse(await readFile(join(directory, name), 'utf8')).minimumSystemVersion).toBe('22.0.0')
    }
    for (const name of ['latest.yml', 'latest-linux.yml']) expect(await readFile(join(directory, name), 'utf8')).toBe(fixture)
  })
})
