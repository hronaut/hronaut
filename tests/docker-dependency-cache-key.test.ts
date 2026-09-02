import { describe, expect, it } from 'vitest'
import { dependencyCacheKey, dependencyLockHash } from '../scripts/docker-dependency-cache-key.js'

const baseLock = {
  name: 'hronaut',
  version: '1.11.30',
  lockfileVersion: 3,
  packages: {
    '': {
      name: 'hronaut',
      version: '1.11.30',
      dependencies: { vue: '^3.5.42' }
    },
    'node_modules/vue': { version: '3.5.42' }
  }
}

describe('focused Docker dependency cache keys', () => {
  it('reuses dependencies across release-only package version changes', () => {
    const nextRelease = structuredClone(baseLock)
    nextRelease.version = '1.11.31'
    nextRelease.packages[''].version = '1.11.31'

    expect(dependencyLockHash(JSON.stringify(nextRelease)))
      .toBe(dependencyLockHash(JSON.stringify(baseLock)))
    const inputs = {
      dockerfileSource: 'dockerfile',
      cacheKeySource: 'cache-key-source',
      installManifestSource: '{}'
    }
    expect(dependencyCacheKey({ ...inputs, packageLockSource: JSON.stringify(nextRelease) }))
      .toBe(dependencyCacheKey({ ...inputs, packageLockSource: JSON.stringify(baseLock) }))
  })

  it('invalidates the cache when an installed dependency changes', () => {
    const dependencyUpdate = structuredClone(baseLock)
    dependencyUpdate.packages['node_modules/vue'].version = '3.6.0'

    expect(dependencyLockHash(JSON.stringify(dependencyUpdate)))
      .not.toBe(dependencyLockHash(JSON.stringify(baseLock)))
  })
})
