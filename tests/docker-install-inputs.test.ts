import { describe, expect, it } from 'vitest'
import { dockerInstallInputs } from '../scripts/docker-install-inputs.js'
import { dependencyLockHash } from '../scripts/docker-dependency-cache-key.js'

const source = {
  name: 'hronaut', version: '2.5.19', lockfileVersion: 3,
  packages: {
    '': { name: 'hronaut', version: '2.5.19', engines: { node: '>=22' }, dependencies: { vue: '^3.5.42' }, scripts: { postinstall: 'do-not-run' } },
    'node_modules/vue': { version: '3.5.42', integrity: 'sha512-fixture', resolved: 'https://registry.npmjs.org/vue/-/vue-3.5.42.tgz' }
  }
}

describe('Docker install inputs', () => {
  it('produces identical install inputs after a release-only version bump', () => {
    const next = structuredClone(source)
    next.version = next.packages[''].version = '2.5.20'
    expect(dockerInstallInputs(JSON.stringify(next))).toEqual(dockerInstallInputs(JSON.stringify(source)))
  })

  it('preserves locked dependencies and root install constraints without invoking application scripts', () => {
    const inputs = dockerInstallInputs(JSON.stringify(source))
    const lock = JSON.parse(inputs.lock)
    expect(lock.packages['node_modules/vue']).toEqual(source.packages['node_modules/vue'])
    expect(JSON.parse(inputs.manifest)).toEqual({ name: 'hronaut', version: '0.0.0', private: true, engines: { node: '>=22' }, dependencies: { vue: '^3.5.42' } })
    expect(dependencyLockHash(inputs.lock)).toBe(dependencyLockHash(JSON.stringify(source)))
  })

  it('invalidates install inputs for dependency and root constraint changes', () => {
    const dependencyUpdate = structuredClone(source)
    dependencyUpdate.packages['node_modules/vue'].integrity = 'sha512-new'
    expect(dockerInstallInputs(JSON.stringify(dependencyUpdate)).lock).not.toBe(dockerInstallInputs(JSON.stringify(source)).lock)
    const constraints = structuredClone(source)
    constraints.packages[''].engines.node = '>=24'
    expect(dockerInstallInputs(JSON.stringify(constraints))).not.toEqual(dockerInstallInputs(JSON.stringify(source)))
  })

  it('rejects a missing lockfile root instead of silently installing an empty manifest', () => {
    expect(() => dockerInstallInputs('{"packages":{}}')).toThrow("packages['']")
  })
})
