import { isReleaseAssetTarget, matchingReleaseAsset } from '../src/shared/release-assets'
import { writeWebClipboardText } from '../src/shared/web-clipboard'

interface ClientConfiguration {
  location: string
  code: string
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubRelease {
  assets: GitHubReleaseAsset[]
}

const endpoint = 'http://127.0.0.1:47812/mcp'
const token = '<token from Hronaut Home>'
const configurations: Record<string, ClientConfiguration> = {
  codex: {
    location: 'Command line',
    code: `export HRONAUT_MCP_TOKEN="${token}"\ncodex mcp add hronaut --url ${endpoint} --bearer-token-env-var HRONAUT_MCP_TOKEN`
  },
  claude: {
    location: 'Command line',
    code: `claude mcp add --transport http --scope user --header "Authorization: Bearer ${token}" hronaut ${endpoint}`
  },
  cursor: {
    location: '~/.cursor/mcp.json',
    code: JSON.stringify({ mcpServers: { hronaut: { url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
  },
  vscode: {
    location: '.vscode/mcp.json',
    code: JSON.stringify({ servers: { hronaut: { type: 'http', url: endpoint, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)
  }
}

const configCode = document.querySelector<HTMLElement>('#config-code')
const configLocation = document.querySelector<HTMLElement>('#config-location')
const copyConfig = document.querySelector<HTMLButtonElement>('#copy-config')
const copyConfigStatus = document.querySelector<HTMLElement>('#copy-config-status')
let copyConfigResetTimer: number | undefined

function legacyCopyText(text: string): boolean {
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.readOnly = true
  textarea.setAttribute('aria-hidden', 'true')
  textarea.style.position = 'fixed'
  textarea.style.inset = '0 auto auto -9999px'
  document.body.append(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  activeElement?.focus()
  return copied
}

function selectConfigurationText(): void {
  if (!configCode) return
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(configCode)
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function selectClient(id: string): void {
  const configuration = configurations[id]
  if (!configuration || !configCode || !configLocation) return
  configCode.textContent = configuration.code
  configLocation.textContent = configuration.location
  document.querySelectorAll<HTMLButtonElement>('[data-client]').forEach((button) => {
    const active = button.dataset.client === id
    button.classList.toggle('active', active)
    button.setAttribute('aria-selected', String(active))
  })
}

document.querySelectorAll<HTMLButtonElement>('[data-client]').forEach((button) => {
  button.addEventListener('click', () => selectClient(button.dataset.client ?? 'codex'))
})

const featureGrid = document.querySelector<HTMLElement>('#feature-grid')
const featureToggle = document.querySelector<HTMLButtonElement>('#feature-toggle')

if (featureGrid && featureToggle) {
  const capabilityCount = featureGrid.querySelectorAll(':scope > article').length
  const setFeaturesExpanded = (expanded: boolean): void => {
    featureGrid.classList.toggle('features-collapsed', !expanded)
    featureToggle.setAttribute('aria-expanded', String(expanded))
    featureToggle.textContent = expanded ? 'Show fewer capabilities' : `Show all ${capabilityCount} capabilities`
  }

  featureToggle.hidden = false
  setFeaturesExpanded(false)
  featureToggle.addEventListener('click', () => {
    setFeaturesExpanded(featureToggle.getAttribute('aria-expanded') !== 'true')
  })
}

copyConfig?.addEventListener('click', async () => {
  if (!configCode) return
  if (copyConfigResetTimer !== undefined) window.clearTimeout(copyConfigResetTimer)
  const text = configCode.textContent ?? ''
  copyConfig.disabled = true
  copyConfig.removeAttribute('title')
  if (copyConfigStatus) copyConfigStatus.textContent = ''
  try {
    await writeWebClipboardText(
      text,
      async (value) => {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable')
        await navigator.clipboard.writeText(value)
      },
      legacyCopyText
    )
    copyConfig.textContent = 'Copied'
    if (copyConfigStatus) copyConfigStatus.textContent = 'MCP configuration copied to the clipboard.'
  } catch (error) {
    selectConfigurationText()
    const message = error instanceof Error ? error.message : 'Clipboard access was blocked. Select and copy the configuration manually.'
    copyConfig.textContent = 'Copy failed'
    copyConfig.title = message
    if (copyConfigStatus) copyConfigStatus.textContent = message
  } finally {
    copyConfig.disabled = false
    copyConfigResetTimer = window.setTimeout(() => {
      copyConfig.textContent = 'Copy'
      copyConfig.removeAttribute('title')
      copyConfigResetTimer = undefined
    }, 2_500)
  }
})

const releaseApi = 'https://api.github.com/repos/hronaut/hronaut/releases/latest'
document.querySelectorAll<HTMLAnchorElement>('[data-download]').forEach((link) => {
  link.addEventListener('click', async (event) => {
    event.preventDefault()
    const fallback = link.href
    const status = document.querySelector<HTMLElement>('#download-status')
    const target = link.dataset.download
    link.setAttribute('aria-busy', 'true')
    if (status) status.textContent = 'Finding the latest release asset on GitHub…'
    try {
      const response = await fetch(releaseApi, { headers: { Accept: 'application/vnd.github+json' } })
      if (!response.ok) throw new Error(`GitHub returned ${response.status}`)
      const release = (await response.json()) as GitHubRelease
      const asset = isReleaseAssetTarget(target) ? matchingReleaseAsset(release.assets, target) : undefined
      if (!asset) throw new Error('No matching release asset was found')
      window.location.assign(asset.browser_download_url)
    } catch {
      window.location.assign(fallback)
    } finally {
      link.removeAttribute('aria-busy')
    }
  })
})

selectClient('codex')
