import { readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface PublicFacts {
  schemaVersion: number
  factSetVersion: string
  lastReviewedAt: string
  product: { name: string; sourceAvailability: string; licenseName: string; licensePath: string }
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
  urls: { homepage: string; setup: string; downloads: string; repository: string }
  platforms: Array<{ name: string; architectures: string[] }>
  clients: Array<{ id: string; name: string; setupUrl: string }>
  historicalPublications: Array<{ url: string; status: string; correctionPath: string }>
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const errors: string[] = []
const read = (path: string): string => readFileSync(resolve(repositoryRoot, path), 'utf8')
const facts = JSON.parse(read('docs/PUBLIC_FACTS.json')) as PublicFacts
const report = (condition: unknown, message: string): void => { if (!condition) errors.push(message) }

report(facts.schemaVersion === 1, 'PUBLIC_FACTS.json has an unsupported schemaVersion')
report(/^\d{4}-\d{2}-\d{2}\.\d+$/u.test(facts.factSetVersion), 'PUBLIC_FACTS.json has an invalid factSetVersion')
report(/^\d{4}-\d{2}-\d{2}$/u.test(facts.lastReviewedAt), 'PUBLIC_FACTS.json has an invalid lastReviewedAt date')
report(facts.product.name === 'Hronaut', 'PUBLIC_FACTS.json has an unexpected product name')
report(facts.product.licensePath === 'LICENSE', 'PUBLIC_FACTS.json must point at LICENSE')
report(facts.subscription.annualReferenceTotal === facts.subscription.monthlyPerNamedUser * 12,
  'The annual reference total does not equal twelve monthly payments')
report(facts.subscription.annualSavingsPercent
  === (1 - facts.subscription.annualPerNamedUser / facts.subscription.annualReferenceTotal) * 100,
'The annual savings percentage does not match the canonical prices')
report(new Set(facts.clients.map(client => client.id)).size === facts.clients.length,
  'PUBLIC_FACTS.json contains duplicate client IDs')

for (const [label, value] of [
  ...Object.entries(facts.urls),
  ...facts.clients.map(client => [`client ${client.id}`, client.setupUrl] as const),
  ...facts.historicalPublications.map((publication, index) => [`historical publication ${index + 1}`, publication.url] as const)
]) {
  try {
    const url = new URL(value)
    report(url.protocol === 'https:' && !url.username && !url.password, `${label} must be a credential-free HTTPS URL`)
  } catch {
    errors.push(`${label} is not a valid public URL`)
  }
}

const currentSurfaces = ['README.md', 'REFERENCE.md', 'website/index.html'] as const
const staleClaims = [
  { pattern: /PolyForm Noncommercial/iu, description: 'superseded PolyForm license wording' },
  { pattern: /\$10\s*(?:\/|per(?:\s+named\s+user)?\s+per)\s*month/iu, description: 'superseded monthly price' },
  { pattern: /\$60\s*(?:\/|per(?:\s+named\s+user)?\s+per)\s*year/iu, description: 'superseded annual price' }
] as const

function checkCurrentClaims(label: string, source: string): void {
  report(source.includes(`$${facts.subscription.monthlyPerNamedUser}`), `${label} is missing the canonical monthly price`)
  report(source.includes(`$${facts.subscription.annualPerNamedUser}`), `${label} is missing the canonical annual price`)
  report(source.includes(`${facts.subscription.annualSavingsPercent}%`), `${label} is missing the canonical annual saving`)
  report(new RegExp(`${facts.subscription.trialDays}[- ]day`, 'iu').test(source), `${label} is missing the canonical trial duration`)
  report(new RegExp(facts.product.sourceAvailability, 'iu').test(source), `${label} is missing the source-availability wording`)
  for (const stale of staleClaims) report(!stale.pattern.test(source), `${label} contains ${stale.description}`)
}

for (const path of currentSurfaces) checkCurrentClaims(path, read(path))

const readme = read('README.md')
for (const client of facts.clients) {
  const hasClientName = client.id === 'generic'
    ? /generic (?:Streamable HTTP |MCP )?(?:setup|client)/iu.test(readme)
    : readme.includes(client.name)
  report(hasClientName, `README.md is missing supported client ${client.name}`)
  report(readme.includes(client.setupUrl), `README.md is missing the setup URL for ${client.name}`)
}
for (const platform of facts.platforms) report(readme.includes(platform.name), `README.md is missing platform ${platform.name}`)

const packageJson = JSON.parse(read('package.json')) as { homepage?: string; license?: string }
const scoop = JSON.parse(read('packaging/scoop/hronaut.json')) as { homepage?: string; license?: string }
for (const [label, manifest] of [['package.json', packageJson], ['packaging/scoop/hronaut.json', scoop]] as const) {
  report(manifest.homepage === facts.urls.homepage, `${label} has a non-canonical homepage`)
  report(manifest.license === 'SEE LICENSE IN LICENSE', `${label} has a non-canonical license declaration`)
}

for (const argument of process.argv.slice(2)) {
  const path = resolve(process.cwd(), argument)
  const label = basename(path)
  try {
    report(statSync(path).size <= 1_048_576, `${label} exceeds the 1 MiB public-copy review limit`)
    const source = readFileSync(path, 'utf8')
    for (const stale of staleClaims) report(!stale.pattern.test(source), `${label} contains ${stale.description}`)
    if (/\b(?:price|pricing|subscription|trial|license)\b|\$\d/iu.test(source)) checkCurrentClaims(label, source)
  } catch (error) {
    errors.push(`${label} could not be read: ${error instanceof Error ? error.message : String(error)}`)
  }
}

if (errors.length) {
  for (const error of errors) console.error(`[public-copy] ${error}`)
  process.exit(1)
}

console.log(`[public-copy] ${facts.factSetVersion} verified: ${currentSurfaces.length} surfaces, ${facts.clients.length} clients, ${facts.platforms.length} platforms.`)
