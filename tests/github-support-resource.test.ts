import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('GitHub support resource', () => {
  it('routes first-use questions to focused, privacy-safe support paths', async () => {
    const support = await readFile('.github/SUPPORT.md', 'utf8')

    expect(support).toContain('https://hronaut.dev/setup')
    expect(support).toContain('STARTER_WORKFLOWS.md')
    expect(support).toContain('issues/new?template=setup-feedback.yml')
    expect(support).toContain('issues/new?template=bug-report.yml')
    expect(support).toContain('security/advisories/new')
    expect(support).toContain('support@hronaut.dev')
    expect(support).toContain('Do not include credentials, MCP tokens, private URLs')
    expect(support).toContain('Hronaut Home')
  })
})
