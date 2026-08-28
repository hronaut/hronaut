import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('focused Docker integration feedback', () => {
  it('builds only the dependency stage and runs the live checkout', async () => {
    const [dockerfile, compose, packageSource] = await Promise.all([
      readFile('Dockerfile.test', 'utf8'),
      readFile('compose.test.focused.yaml', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }
    const focusedScript = packageJson.scripts['test:integration:docker:focused']

    expect(dockerfile).toContain('AS dependencies')
    expect(dockerfile).toContain('FROM dependencies AS integration')
    expect(compose).toContain('target: dependencies')
    expect(compose).toContain('source: .')
    expect(compose).toContain('target: /workspace')
    expect(compose).toContain('target: /workspace/node_modules')
    expect(focusedScript).toContain('--file compose.test.focused.yaml')
    expect(focusedScript).toContain('run --build --rm integration')
    expect(focusedScript).toContain('scripts/run-focused-integration-docker.sh')
  })

  it('keeps the full Docker gate on the immutable source image', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['test:integration:docker']).toBe(
      'docker compose --file compose.test.ci.yaml run --build --rm integration'
    )
  })
})
