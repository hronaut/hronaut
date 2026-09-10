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
    const [readme, reference, website, checklist, packageSource, scoopSource] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('REFERENCE.md', 'utf8'),
      readFile('website/index.html', 'utf8'),
      readFile('docs/PUBLISHING_CHECKLIST.md', 'utf8'),
      readFile('package.json', 'utf8'),
      readFile('packaging/scoop/hronaut.json', 'utf8')
    ])
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

  it('validates current surfaces and rejects stale public pricing copy', async () => {
    expect(spawnSync(process.execPath, [verifier], { encoding: 'utf8' })).toMatchObject({ status: 0 })

    const directory = await mkdtemp(join(tmpdir(), 'hronaut-public-copy-'))
    temporaryDirectories.push(directory)
    const stale = join(directory, 'announcement.md')
    await writeFile(stale, 'Hronaut commercial use costs $10/month or $60/year under PolyForm Noncommercial.')
    const result = spawnSync(process.execPath, [verifier, stale], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('announcement.md')
    expect(result.stderr).toContain('superseded')
  })
})
