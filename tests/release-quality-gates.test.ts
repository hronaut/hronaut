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

  it('gives each published release a factual demo, download, setup, and license path', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')

    expect(workflow).toContain("echo '## Start here'")
    expect(workflow).toContain('https://hronaut.dev/#demo')
    expect(workflow).toContain('https://hronaut.dev/download')
    expect(workflow).toContain('https://hronaut.dev/setup')
    expect(workflow).toContain('PolyForm Noncommercial 1.0.0')
    expect(workflow.indexOf('<!-- unsigned-release-warning -->')).toBeLessThan(workflow.indexOf("echo '## Start here'"))
    expect(workflow.indexOf("echo '## Start here'")).toBeLessThan(workflow.indexOf('echo "## What\'s changed"'))
  })

  it('retains bounded Playwright diagnostics when Docker integration fails', async () => {
    const [ciWorkflow, releaseWorkflow, runner, playwright] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('scripts/run-integration-ci.sh', 'utf8'),
      readFile('playwright.config.ts', 'utf8')
    ])

    for (const integration of [job(ciWorkflow, 'integration'), job(releaseWorkflow, 'test-integration')]) {
      expect(integration).toContain('run: bash scripts/run-integration-ci.sh')
      expect(integration).toContain('if: failure()')
      expect(integration).toContain('uses: actions/upload-artifact@v7')
      expect(integration).toContain('path: ci-artifacts/')
      expect(integration).toContain('retention-days: 7')
    }
    expect(playwright).toContain("trace: process.env.CI ? 'retain-on-first-failure' : 'off'")
    expect(runner).toContain('docker compose --file compose.test.ci.yaml run --build --name "$container_name" integration')
    expect(runner).toContain('docker cp "$container_name:/workspace/$source_directory" - | tar -xf - -C "$artifact_directory"')
    expect(runner).toContain('docker rm --force "$container_name"')
    expect(runner).not.toContain('run --build --rm integration')
  })
})
