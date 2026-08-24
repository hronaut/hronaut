import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

function job(source: string, name: string): string {
  const marker = `  ${name}:\n`
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`Workflow job not found: ${name}`)
  const contents = source.slice(start + marker.length)
  const nextJob = contents.search(/^ {2}[a-zA-Z0-9-]+:\n/m)
  return nextJob < 0 ? contents : contents.slice(0, nextJob)
}

describe('release quality gates', () => {
  it('runs lint with tests and the production build in pull-request CI', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const validate = job(workflow, 'validate')

    expect(validate).toContain('run: npm run lint')
    expect(validate).toContain('run: npm test')
    expect(validate).toContain('run: npm run build')
  })

  it('validates the immutable tag before any platform release build starts', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const validate = job(workflow, 'validate')

    expect(validate).toContain('needs: prepare-release')
    expect(validate).toContain('ref: ${{ needs.prepare-release.outputs.sha }}')
    expect(validate).toContain('run: npm run lint')
    expect(validate).toContain('run: npm test')
    expect(validate).toContain('run: npm run build')
    expect(validate).toContain('run: npm audit --omit=dev --audit-level=high')

    for (const build of ['build-linux', 'build-macos', 'build-windows']) {
      expect(job(workflow, build)).toMatch(/needs:\n(?: {6}- .+\n)* {6}- validate\n/)
    }
  })
})
