import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_GUIDE_IDS, AGENT_GUIDE_NAMES } from '../src/shared/agent-guides.js'
import { AGENT_GUIDE_URLS } from '../src/main/setup-feedback-links.js'

interface PublicFacts {
  schemaVersion: number
  factSetVersion: string
  lastReviewedAt: string
  product: {
    name: string
    sourceAvailability: string
    licenseName: string
    licenseIdentifier: string
    licensePath: string
  }
  subscription: {
    trialDays: number
    trialStartsAt: string
    currency: string
    monthlyPerNamedUser: number
    annualPerNamedUser: number
    annualReferenceTotal: number
    annualSavingsPercent: number
    activeDevicesPerSeat: number
  }
  urls: Record<string, string>
  directoryListing: {
    description: string
    deployment: string
    remoteDeploymentSupported: boolean
    install: string
    transport: string
    networkScope: string
    visibleBrowser: boolean
    humanTakeover: boolean
  }
  mcpRegistry: {
    name: string
    registryType: string
    latestRecordUrl: string
    versionRecordUrlTemplate: string
    adapterGuideUrl: string
    desktopApplicationRequired: boolean
    startsDesktopApplication: boolean
    remoteDeploymentSupported: boolean
  }
  platforms: Array<{ name: string; architectures: string[] }>
  clients: Array<{ id: string; name: string; setupUrl: string }>
  historicalPublications: Array<{ url: string; status: string; correctionPath: string }>
}

const temporaryDirectories: string[] = []
const verifier = resolve('scripts/check-public-copy.ts')

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

async function facts(): Promise<PublicFacts> {
  return JSON.parse(await readFile('docs/PUBLIC_FACTS.json', 'utf8')) as PublicFacts
}

describe('canonical public facts', () => {
  it('pins the current license, price, setup, platform, and client facts in one versioned source', async () => {
    const value = await facts()
    expect(value).toMatchObject({
      schemaVersion: 1,
      product: {
        name: 'Hronaut',
        sourceAvailability: 'source-available',
        licenseName: 'Hronaut Subscription and Trial License',
        licenseIdentifier: 'LicenseRef-Hronaut-Subscription-and-Trial',
        licensePath: 'LICENSE'
      },
      subscription: {
        trialDays: 10,
        trialStartsAt: 'first agent tool call',
        currency: 'USD',
        monthlyPerNamedUser: 4,
        annualPerNamedUser: 24,
        annualReferenceTotal: 48,
        annualSavingsPercent: 50,
        activeDevicesPerSeat: 3
      },
      urls: {
        homepage: 'https://hronaut.dev',
        setup: 'https://hronaut.dev/setup',
        downloads: 'https://github.com/hronaut/hronaut/releases/latest',
        repository: 'https://github.com/hronaut/hronaut'
      },
      directoryListing: {
        description: 'A visible desktop browser with persistent, isolated workspaces controlled by local coding agents through MCP.',
        deployment: 'local-only',
        remoteDeploymentSupported: false,
        install: 'Download and start the Hronaut desktop application, then copy its local MCP setup from Hronaut Home.',
        transport: 'streamable-http',
        networkScope: 'loopback-only',
        visibleBrowser: true,
        humanTakeover: true
      },
      mcpRegistry: {
        name: 'io.github.hronaut/hronaut',
        registryType: 'mcpb',
        latestRecordUrl: 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.hronaut%2Fhronaut/versions/latest',
        versionRecordUrlTemplate: 'https://registry.modelcontextprotocol.io/v0.1/servers/io.github.hronaut%2Fhronaut/versions/{version}',
        adapterGuideUrl: 'https://github.com/hronaut/hronaut/blob/main/docs/MCPB_ADAPTER.md',
        desktopApplicationRequired: true,
        startsDesktopApplication: false,
        remoteDeploymentSupported: false
      }
    })
    expect(value.factSetVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/u)
    expect(value.lastReviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/u)
    expect(value.platforms).toEqual([
      { name: 'Windows', architectures: ['x64'] },
      { name: 'macOS', architectures: ['arm64', 'x64'] },
      { name: 'Linux', architectures: ['arm64', 'x64'] }
    ])
    expect(value.clients).toEqual(AGENT_GUIDE_IDS.map(id => ({
      id,
      name: AGENT_GUIDE_NAMES[id],
      setupUrl: AGENT_GUIDE_URLS[id]
    })))
  })

  it('keeps repository distribution surfaces aligned and documents historical corrections', async () => {
    const value = await facts()
    const [readme, reference, website, checklist, directoryGuide, supportGuide, glamaSource, packageSource, scoopSource] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('REFERENCE.md', 'utf8'),
      readFile('website/index.html', 'utf8'),
      readFile('docs/PUBLISHING_CHECKLIST.md', 'utf8'),
      readFile('docs/DIRECTORY_LISTINGS.md', 'utf8'),
      readFile('docs/SUPPORT_RECOVERY.md', 'utf8'),
      readFile('glama.json', 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('packaging/scoop/hronaut.json', 'utf8')
    ])
    const glama = JSON.parse(glamaSource) as Record<string, unknown>
    const packageJson = JSON.parse(packageSource) as { homepage?: string; license?: string; scripts?: Record<string, string> }
    const scoop = JSON.parse(scoopSource) as { homepage?: string; license?: string }

    for (const surface of [readme, reference, website]) {
      expect(surface).toContain('$4')
      expect(surface).toContain('$24')
      expect(surface).toContain('50%')
      expect(surface).toMatch(/10-day|10 day/u)
      expect(surface).toMatch(/source-available/iu)
      expect(surface).not.toMatch(/PolyForm Noncommercial|\$10\s*\/\s*month|\$60\s*\/\s*year/iu)
    }
    expect(packageJson).toMatchObject({ homepage: value.urls.homepage, license: 'SEE LICENSE IN LICENSE' })
    expect(scoop).toMatchObject({ homepage: value.urls.homepage, license: 'SEE LICENSE IN LICENSE' })
    expect(packageJson.scripts?.['check:public-copy']).toBe('node scripts/check-public-copy.ts')
    expect(checklist).toContain('[`PUBLIC_FACTS.json`](PUBLIC_FACTS.json)')
    expect(checklist).toContain('npm run check:public-copy -- path/to/draft.md')
    expect(checklist).toContain('historical')
    expect(directoryGuide).toContain('[`PUBLIC_FACTS.json`](PUBLIC_FACTS.json)')
    expect(directoryGuide).toMatch(/Remote deployment is not\s+supported/u)
    expect(directoryGuide).toMatch(/Do not submit the loopback MCP\s+URL as a remote connector endpoint/u)
    for (const surface of [readme, directoryGuide]) {
      expect(surface).toContain(value.mcpRegistry.name)
      expect(surface).toContain(value.mcpRegistry.latestRecordUrl)
      expect(surface).toContain(value.mcpRegistry.adapterGuideUrl)
      expect(surface).toMatch(/does not (?:install or\s+)?start (?:the )?Hronaut desktop (?:app|application)/iu)
      expect(surface).toMatch(/hosted agents? cannot reach|cannot make[\s\S]{0,100}reachable from hosted agents/iu)
    }
    expect(readme).toContain('[Support, recovery, and exit path](docs/SUPPORT_RECOVERY.md)')
    expect(value.urls.supportRecovery).toBe('https://github.com/hronaut/hronaut/blob/main/docs/SUPPORT_RECOVERY.md')
    expect(supportGuide).toContain(`Fact set: ${value.factSetVersion}`)
    expect(supportGuide).toContain(`Last verified: ${value.lastReviewedAt}`)
    expect(supportGuide).toContain('support@hronaut.dev')
    expect(supportGuide).toContain('https://github.com/hronaut/hronaut/issues')
    for (const platform of value.platforms) expect(supportGuide).toContain(platform.name)
    expect(supportGuide).toMatch(/local Streamable HTTP MCP/iu)
    expect(supportGuide).toMatch(/does not export cookies,\s+credentials,\s+saved passwords, or raw private page content/iu)
    expect(supportGuide).toMatch(/workspace, profile,\s+account, origin, and tab/iu)
    expect(supportGuide).toMatch(/navigation and session generation/iu)
    expect(supportGuide).toMatch(/not an OAuth\/OIDC provider, identity broker,\s+enterprise access-control system, or hosted browser fleet/iu)
    expect(glama).toEqual({
      $schema: 'https://glama.ai/mcp/schemas/server.json',
      maintainers: ['Hronom']
    })
    expect(value.historicalPublications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: 'https://www.reddit.com/r/mcp/comments/1w9c6hv/hronaut_a_local_browser_mcp_that_keeps_its/',
        status: 'historical'
      })
    ]))
    for (const publication of value.historicalPublications) {
      expect(publication.correctionPath).toMatch(/canonical|current|historical/iu)
    }
  })

  it('validates current surfaces and rejects stale pricing or remote-deployment copy', async () => {
    expect(spawnSync(process.execPath, [verifier], { encoding: 'utf8' })).toMatchObject({ status: 0 })

    const directory = await mkdtemp(join(tmpdir(), 'hronaut-public-copy-'))
    temporaryDirectories.push(directory)
    const stale = join(directory, 'announcement.md')
    await writeFile(stale, 'Hronaut commercial use costs $10/month or $60/year under PolyForm Noncommercial.')
    const result = spawnSync(process.execPath, [verifier, stale], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('announcement.md')
    expect(result.stderr).toContain('superseded')

    const misleadingDirectoryCopy = join(directory, 'directory-listing.md')
    await writeFile(misleadingDirectoryCopy, 'Click Deploy Server and wait for Hronaut to deploy as a hosted Hronaut connector.')
    const directoryResult = spawnSync(process.execPath, [verifier, misleadingDirectoryCopy], { encoding: 'utf8' })
    expect(directoryResult.status).toBe(1)
    expect(directoryResult.stderr).toContain('unsupported remote deployment claim')
  })
})
