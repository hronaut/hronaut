import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('focused Docker integration feedback', () => {
  it('builds only the dependency stage and runs the live checkout', async () => {
    const [dockerfile, compose, packageSource, launcher, verifier] = await Promise.all([
      readFile('Dockerfile.test', 'utf8'),
      readFile('compose.test.focused.yaml', 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('scripts/run-focused-docker.ts', 'utf8'),
      readFile('scripts/run-with-verified-dependencies.sh', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }
    const focusedScript = packageJson.scripts['test:integration:docker:focused']

    expect(dockerfile).toContain('AS dependencies')
    expect(dockerfile).toContain('FROM dependencies AS integration')
    expect(dockerfile).toContain('COPY package-lock.json ./')
    expect(dockerfile).not.toContain('COPY package.json package-lock.json ./')
    expect(dockerfile).toContain('node node_modules/electron/install.js')
    expect(compose).toContain('target: dependencies')
    expect(compose).toContain('source: .')
    expect(compose).toContain('target: /workspace')
    expect(compose).toContain('source: focused-node-modules')
    expect(compose).toContain('target: /workspace/node_modules')
    expect(compose).toContain('hronaut-focused-node-modules-${HRONAUT_DEPENDENCY_CACHE_KEY')
    expect(compose).toContain('external: true')
    expect(focusedScript).toBe('node scripts/run-focused-docker.ts integration')
    expect(launcher).toContain("createHash('sha256')")
    expect(launcher).toContain("'package-lock.json'")
    expect(launcher).toContain("'Dockerfile.test'")
    expect(launcher).toContain('HRONAUT_DEPENDENCY_CACHE_KEY')
    expect(launcher).toContain("['volume', 'create', volumeName]")
    expect(launcher).toContain("'--project-name', `hronaut-focused-${dependencyCacheKey}`")
    expect(launcher).toContain('run-with-verified-dependencies.sh')
    expect(verifier).toContain('node_modules/.hronaut-package-lock.sha256')
    expect(dockerfile).toContain('node_modules/.hronaut-package-lock.sha256')
  })

  it('runs a selected unit test in the same live-checkout Docker environment', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['test:unit:docker:focused']).toBe(
      'node scripts/run-focused-docker.ts unit'
    )
  })

  it('runs a warm full Electron preflight without repeating type analysis', async () => {
    const [packageSource, launcher] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('scripts/run-focused-docker.ts', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['test:integration:docker:fast']).toBe(
      'node scripts/run-focused-docker.ts integration-all'
    )
    expect(launcher).toContain("mode === 'integration-all'")
    expect(launcher).toContain("HRONAUT_INTEGRATION_SKIP_TYPECHECK: 'true'")
    expect(launcher).toContain("['bash', 'scripts/run-integration-suite-docker.sh']")
  })

  it('keeps the full Docker gate on the immutable source image', async () => {
    const [packageSource, dockerfile, compose, runner, ciRunner, playwright] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('Dockerfile.test', 'utf8'),
      readFile('compose.test.ci.yaml', 'utf8'),
      readFile('scripts/run-integration-suite-docker.sh', 'utf8'),
      readFile('scripts/run-integration-ci.sh', 'utf8'),
      readFile('playwright.config.ts', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['test:integration:docker']).toBe(
      'docker compose --file compose.test.ci.yaml run --build --rm integration'
    )
    expect(dockerfile).toContain('CMD ["bash", "scripts/run-integration-suite-docker.sh"]')
    expect(compose).toContain('HRONAUT_INTEGRATION_SHARDS: "${HRONAUT_INTEGRATION_SHARDS:-6}"')
    expect(compose).toContain('HRONAUT_INTEGRATION_SKIP_TYPECHECK: "${HRONAUT_INTEGRATION_SKIP_TYPECHECK:-false}"')
    expect(ciRunner).toContain('HRONAUT_INTEGRATION_SHARDS="${HRONAUT_INTEGRATION_SHARDS:-2}"')
    expect(ciRunner).toContain('HRONAUT_INTEGRATION_SKIP_TYPECHECK="true"')
    expect(runner).toContain('node scripts/verify-dependency-manifest.ts')
    expect(runner).toContain('npm run build')
    expect(runner).toContain('npm run build:app')
    expect(runner).toContain('HRONAUT_INTEGRATION_SKIP_TYPECHECK')
    expect(runner).toContain('HRONAUT_TEST_SHARD=')
    expect(runner).toContain('--shard=')
    expect(runner).toContain('npm run test:integration:dialogs:headless')
    expect(runner).toContain('1|2|3|4|5|6|7|8')
    expect(playwright).toContain('process.env.HRONAUT_TEST_SHARD')
    expect(playwright).toContain('fullyParallel: true')
    expect(playwright).toContain('playwright-report/${artifactShard}')
    expect(playwright).toContain('test-results/integration/${artifactShard}')
  })

  it('distributes hosted Electron shards across isolated runners', async () => {
    const [workflow, compose, runner] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('compose.test.ci.yaml', 'utf8'),
      readFile('scripts/run-integration-suite-docker.sh', 'utf8')
    ])

    expect(workflow).toContain('integration-shard:')
    expect(workflow).toContain('shard: [1, 2]')
    expect(workflow).toContain('HRONAUT_INTEGRATION_SHARD: "${{ matrix.shard }}/2"')
    expect(workflow).toContain('HRONAUT_INTEGRATION_RUN_DIALOGS: "${{ matrix.shard == 1 }}"')
    expect(workflow).toContain('needs: integration-shard')
    expect(compose).toContain('HRONAUT_INTEGRATION_SHARD: "${HRONAUT_INTEGRATION_SHARD:-}"')
    expect(compose).toContain('HRONAUT_INTEGRATION_RUN_DIALOGS: "${HRONAUT_INTEGRATION_RUN_DIALOGS:-true}"')
    expect(runner).toContain('HRONAUT_INTEGRATION_SHARD')
    expect(runner).toContain('HRONAUT_INTEGRATION_RUN_DIALOGS')
    expect(runner).toContain('"--shard=${shard_spec}"')
    expect(runner).toContain('run_shard "$single_shard" "$single_shard_index"')
  })

  it('reuses the immutable Docker dependency layers in hosted CI', async () => {
    const [workflow, ciRunner] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('scripts/run-integration-ci.sh', 'utf8')
    ])

    expect(workflow).toContain('uses: docker/setup-buildx-action@v4')
    expect(workflow).toContain('uses: docker/build-push-action@v7')
    expect(workflow).toContain('target: integration')
    expect(workflow).toContain('load: true')
    expect(workflow).toContain('tags: hronaut-tests-integration:latest')
    expect(workflow).toContain('cache-from: type=gha,scope=hronaut-integration')
    expect(workflow).toContain('cache-to: type=gha,mode=max,scope=hronaut-integration')
    expect(workflow).toContain('HRONAUT_INTEGRATION_IMAGE_PREBUILT: "true"')
    expect(ciRunner).toContain('HRONAUT_INTEGRATION_IMAGE_PREBUILT')
    expect(ciRunner).toContain("compose_build_argument='--no-build'")
    expect(ciRunner).toContain("compose_build_argument='--build'")
  })

  it('avoids repeated type analysis in fast build feedback and caches lint results', async () => {
    const [packageSource, focusedRunner, typecheckRunner] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('scripts/run-focused-integration-docker.sh', 'utf8'),
      readFile('scripts/run-typecheck-projects.ts', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.lint).toContain('--cache')
    expect(packageJson.scripts.lint).toContain('--cache-strategy content')
    expect(packageJson.scripts['lint:focused']).not.toContain('eslint .')
    expect(packageJson.scripts.typecheck).toBe('npm run typecheck:incremental')
    expect(packageJson.scripts['typecheck:incremental']).toBe(
      'node scripts/run-typecheck-projects.ts'
    )
    expect(packageJson.scripts['typecheck:web']).toContain('tsconfig.web.json')
    expect(packageJson.scripts['typecheck:node']).toContain('tsconfig.node.json')
    expect(packageJson.scripts['typecheck:website']).toContain('tsconfig.website.json')
    expect(typecheckRunner).toContain('HRONAUT_TYPECHECK_JOBS')
    expect(typecheckRunner).toContain("'tsconfig.node.json'")
    expect(typecheckRunner).toContain("'tsconfig.web.json'")
    expect(typecheckRunner).toContain("'tsconfig.website.json'")
    expect(packageJson.scripts['build:app']).toBe('electron-vite build')
    expect(focusedRunner).toContain('npm run build:app')
    expect(focusedRunner).not.toContain('npm run build\n')
  })

  it('runs independent static gates concurrently and allows CI worker tuning', async () => {
    const [packageSource, staticRunner, vitest] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('scripts/run-static-gates.ts', 'utf8'),
      readFile('vitest.config.ts', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts.validate).toBe('node scripts/run-static-gates.ts')
    expect(staticRunner).toContain("['run', 'lint']")
    expect(staticRunner).toContain("['test']")
    expect(staticRunner).toContain("['run', 'typecheck']")
    expect(staticRunner).toContain("['run', 'build:app']")
    expect(vitest).toContain('HRONAUT_VITEST_WORKERS')
    expect(vitest).toContain("process.env.CI ? ciMaxWorkers : undefined")
  })

  it('offers concurrent lint and owning-project typechecks for focused edits', async () => {
    const [packageSource, focusedStaticRunner] = await Promise.all([
      readFile('package.json', 'utf8'),
      readFile('scripts/run-focused-static-gates.ts', 'utf8')
    ])
    const packageJson = JSON.parse(packageSource) as {
      scripts: Record<string, string>
    }

    expect(packageJson.scripts['validate:focused']).toBe(
      'node scripts/run-focused-static-gates.ts'
    )
    expect(focusedStaticRunner).toContain("['run', 'lint:focused', '--', ...files]")
    expect(focusedStaticRunner).toContain('typecheckScriptsForFiles(files)')
    expect(focusedStaticRunner).toContain('Promise.all')
  })

  it('assigns each Electron shard a distinct MCP port range', async () => {
    const [runner, fixtures] = await Promise.all([
      readFile('scripts/run-integration-suite-docker.sh', 'utf8'),
      readFile('tests/integration/fixtures.ts', 'utf8')
    ])

    expect(runner).toContain('HRONAUT_TEST_SHARD_INDEX=')
    expect(fixtures).toContain("integrationMcpPort(process.env.HRONAUT_TEST_SHARD_INDEX, testInfo.workerIndex)")
  })
})
