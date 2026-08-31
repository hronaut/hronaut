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
  it('runs the concurrent static validation gate in pull-request CI', async () => {
    const [workflow, packageSource] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('package.json', 'utf8')
    ])
    const validate = job(workflow, 'validate')
    const releaseCandidate = job(workflow, 'package-release-candidate')
    const packageJson = JSON.parse(packageSource) as { scripts: Record<string, string> }

    expect(validate).toContain('run: npm run validate')
    expect(validate).toContain('HRONAUT_TYPECHECK_JOBS: "1"')
    expect(validate).not.toContain('run: npm run lint')
    expect(validate).not.toContain('run: npm test')
    expect(validate).not.toContain('run: npm run build\n')
    expect(releaseCandidate).toContain('command: package:linux')
    expect(releaseCandidate).toContain('command: package:mac')
    expect(releaseCandidate).toContain('command: package:win')
    for (const platform of ['linux', 'mac', 'win']) {
      expect(packageJson.scripts[`package:${platform}`]).toContain('npm run build:app')
      expect(packageJson.scripts[`package:${platform}`]).not.toContain('npm run build &&')
    }
  })

  it('restores complete TypeScript build state only after install and saves it only after validation', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
    const validate = job(workflow, 'validate')
    const install = validate.indexOf('name: Install dependencies')
    const restore = validate.indexOf('uses: actions/cache/restore@v6')
    const staticValidation = validate.indexOf('run: npm run validate')
    const save = validate.indexOf('uses: actions/cache/save@v6')
    const configHash = "${{ hashFiles('package-lock.json', 'tsconfig.json', 'tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.website.json') }}"
    const cachePrefix = `typecheck-\${{ runner.os }}-node24-${configHash}`

    expect(install).toBeGreaterThanOrEqual(0)
    expect(restore).toBeGreaterThan(install)
    expect(staticValidation).toBeGreaterThan(restore)
    expect(save).toBeGreaterThan(staticValidation)
    expect(validate).toContain('if: success()')
    expect(validate).toContain(`key: ${cachePrefix}-\${{ github.sha }}`)
    expect(validate).toContain(`restore-keys: |\n            ${cachePrefix}-`)
    for (const path of [
      'tsconfig.node.tsbuildinfo',
      'tsconfig.web.tsbuildinfo',
      'tsconfig.website.tsbuildinfo'
    ]) expect(validate).toContain(path)
  })

  it('validates the immutable tag before any platform release build starts', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const validate = job(workflow, 'validate')

    expect(validate).toContain('needs: prepare-release')
    expect(validate).toContain('ref: ${{ needs.prepare-release.outputs.sha }}')
    expect(validate).toContain('run: npm run validate')
    expect(validate).not.toContain('run: npm run lint')
    expect(validate).not.toContain('run: npm test')
    expect(validate).not.toContain('run: npm run build\n')
    expect(validate).toContain('run: npm audit --omit=dev --audit-level=high')

    for (const build of ['build-linux', 'build-macos', 'build-windows']) {
      const buildJob = job(workflow, build)
      expect(buildJob).toMatch(/needs:\n(?: {6}- .+\n)* {6}- validate\n/)
      expect(buildJob).toContain('npm run build:app')
      expect(buildJob).not.toContain('npm run build\n')
    }
  })

  it('gives each published release a factual demo, download, setup, and license path', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')

    expect(workflow).toContain("echo '## Start here'")
    expect(workflow).toContain('https://hronaut.dev/#demo')
    expect(workflow).toContain('https://hronaut.dev/download')
    expect(workflow).toContain('https://hronaut.dev/setup')
    expect(workflow).toContain('Codex, Claude Code, Gemini CLI, Cursor, Copilot, OpenCode, Cline, Kiro, Kilo Code, JetBrains Junie, Devin Local, Zed, Mistral Vibe, Warp, or another MCP client')
    expect(workflow).toContain('PolyForm Noncommercial 1.0.0')
    expect(workflow.indexOf('<!-- unsigned-release-warning -->')).toBeLessThan(workflow.indexOf("echo '## Start here'"))
    expect(workflow.indexOf("echo '## Start here'")).toBeLessThan(workflow.indexOf('echo "## What\'s changed"'))
  })

  it('verifies hronaut.dev has resolved every published release and download', async () => {
    const workflow = await readFile('.github/workflows/release.yml', 'utf8')
    const verification = job(workflow, 'verify-public-release')

    expect(verification).toContain('- publish-release')
    expect(verification).toContain('ref: ${{ needs.prepare-release.outputs.sha }}')
    expect(verification).toContain('VERSION: ${{ needs.prepare-release.outputs.version }}')
    expect(verification).toContain('run: node scripts/verify-public-release.ts "$VERSION"')
  })

  it('retains bounded Playwright diagnostics when Docker integration fails', async () => {
    const [ciWorkflow, releaseWorkflow, runner, playwright] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('.github/workflows/release.yml', 'utf8'),
      readFile('scripts/run-integration-ci.sh', 'utf8'),
      readFile('playwright.config.ts', 'utf8')
    ])

    for (const integration of [job(ciWorkflow, 'integration-shard'), job(releaseWorkflow, 'test-integration')]) {
      expect(integration).toContain('run: bash scripts/run-integration-ci.sh')
      expect(integration).not.toContain('docker/build-push-action')
      expect(integration).not.toContain('type=gha,scope=hronaut-integration')
      expect(integration).not.toContain('HRONAUT_INTEGRATION_IMAGE_PREBUILT')
      expect(integration).toContain('if: failure()')
      expect(integration).toContain('uses: actions/upload-artifact@v7')
      expect(integration).toContain('path: ci-artifacts/')
      expect(integration).toContain('retention-days: 7')
    }
    expect(playwright).toContain('retries: process.env.CI ? 1 : 0')
    expect(playwright).toContain('failOnFlakyTests: Boolean(process.env.CI)')
    expect(playwright).toContain("trace: process.env.CI ? 'on-first-retry' : 'off'")
    expect(runner).toContain('compose_build_arguments+=(--build)')
    expect(runner).not.toContain('--no-build')
    expect(runner).toContain('docker compose --file compose.test.ci.yaml run "${compose_build_arguments[@]}" --name "$container_name" integration')
    expect(runner).toContain('docker cp "$container_name:/workspace/$source_directory" - | tar -xf - -C "$artifact_directory"')
    expect(runner).toContain('docker rm --force "$container_name"')
    expect(runner).not.toContain('run --build --rm integration')
  })

  it('keeps wallet documentation in the website public source before output cleanup', async () => {
    const [config, publicWallets, builtWallets] = await Promise.all([
      readFile('vite.website.config.ts', 'utf8'),
      readFile('website/public/WALLETS.md', 'utf8'),
      readFile('docs/WALLETS.md', 'utf8')
    ])

    expect(config).toContain("root: 'website'")
    expect(config).toContain("outDir: '../docs'")
    expect(config).toContain('emptyOutDir: true')
    expect(publicWallets).toBe(builtWallets)
  })

  it('keeps the reference aligned with the implemented local-wallet trust model', async () => {
    const reference = await readFile('REFERENCE.md', 'utf8')

    expect(reference).toContain('## Local Web3 wallets')
    expect(reference).toContain('[wallet security and usage reference](docs/WALLETS.md)')
    expect(reference).toContain('Mainnet defaults to explicit human approval')
    expect(reference).toContain('Bypass Approve')
    expect(reference).toContain('does not integrate WalletConnect, Reown, or external-wallet SDKs')
    expect(reference).not.toContain('external-wallet signing')
    expect(reference).not.toContain('design/web3-wallet-architecture.md')
  })
})
