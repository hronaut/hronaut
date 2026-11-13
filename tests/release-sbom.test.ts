import { describe, expect, it } from 'vitest'
import { releaseSbom } from '../scripts/release-sbom.js'

describe('release SBOM', () => {
  const npmBom = {
    bomFormat: 'CycloneDX',
    metadata: { timestamp: '2026-11-13T00:00:00.000Z', component: { version: '0.0.0' } },
    components: [{ type: 'library', name: 'zod', version: '4.0.0' }]
  }

  it('adds the bundled Electron runtime and stamps the release version and time', () => {
    const bom = releaseSbom(npmBom, '45.3.0', '3.14.30', '2026-11-14T10:00:00Z')
    expect(bom.metadata).toMatchObject({ timestamp: '2026-11-14T10:00:00Z', component: { version: '3.14.30' } })
    expect(bom.components?.map(({ name, version }) => `${name}@${version}`)).toEqual(['zod@4.0.0', 'electron@45.3.0'])
    expect(bom.components?.at(-1)).toMatchObject({ type: 'framework', purl: 'pkg:npm/electron@45.3.0' })
  })

  it('refuses a document that is not CycloneDX or an unknown Electron version', () => {
    expect(() => releaseSbom({ ...npmBom, bomFormat: 'SPDX' }, '45.3.0', '3.14.30', 'now')).toThrow('CycloneDX')
    expect(() => releaseSbom(npmBom, '', '3.14.30', 'now')).toThrow('Electron version')
  })
})
