export type CommandPaletteCategory = 'Agents' | 'Navigation' | 'Current website' | 'Application'

export type CommandPaletteCommandId =
  | 'home'
  | 'new-tab'
  | 'search-tabs'
  | 'switch-workspace'
  | 'downloads'
  | 'bookmarks'
  | 'history'
  | 'find'
  | 'reload'
  | 'reload-ignoring-cache'
  | 'capture-area'
  | 'capture-element'
  | 'capture-viewport'
  | 'capture-full-page'
  | 'copy-snapshot'
  | 'pick-element'
  | 'page-tools'
  | 'site-storage'
  | 'responsive-preview'
  | 'environment'
  | 'console'
  | 'network'
  | 'request-conditions'
  | 'issues'
  | 'debug-report'
  | 'repro-recorder'
  | 'dom-changes'
  | 'visual-compare'
  | 'quality-audit'
  | 'accessibility'
  | 'performance'
  | 'design-overview'
  | 'page-metadata'
  | 'security'
  | 'coverage'
  | 'cpu-profile'
  | 'memory'
  | 'developer-tools'
  | 'full-page-view'
  | 'settings'
  | 'privacy'
  | 'site-permissions'
  | 'mcp-security'
  | 'updates'
  | 'keyboard-shortcuts'
  | 'toggle-mcp-pause'
  | 'agent-card'
  | 'take-over'

export interface CommandPaletteCommand {
  id: CommandPaletteCommandId
  label: string
  description: string
  category: CommandPaletteCategory
  keywords?: readonly string[]
  shortcut?: string
  websiteOnly?: boolean
  /** Offered only while an agent works in the workspace in view. */
  agentOnly?: boolean
}

export const COMMAND_PALETTE_COMMANDS: readonly CommandPaletteCommand[] = [
  { id: 'home', label: 'Open Hronaut Home', description: 'Show the application dashboard', category: 'Navigation', keywords: ['dashboard'] },
  { id: 'new-tab', label: 'New tab', description: 'Open a blank tab in the Default workspace', category: 'Navigation', shortcut: 'Ctrl/Cmd+T' },
  { id: 'search-tabs', label: 'Search tabs', description: 'Find open, saved, and recently closed websites', category: 'Navigation', keywords: ['switch', 'restore', 'groups', 'workspace'], shortcut: 'Ctrl/Cmd+Shift+A' },
  { id: 'switch-workspace', label: 'Switch workspace', description: 'Go to a workspace by its name, agents, or sites', category: 'Navigation', keywords: ['workspace', 'project', 'client', 'jump', 'go to', 'agent', 'archived'], shortcut: 'Ctrl/Cmd+K' },
  { id: 'downloads', label: 'Show downloads', description: 'Review current and completed downloads', category: 'Navigation', keywords: ['files'] },
  { id: 'bookmarks', label: 'Show bookmarks', description: 'Open locally saved pages', category: 'Navigation', keywords: ['favorites', 'star'] },
  { id: 'history', label: 'Show browsing history', description: 'Search locally visited pages', category: 'Navigation', keywords: ['visits'], shortcut: 'Ctrl+H / Cmd+Y' },
  { id: 'find', label: 'Find in page', description: 'Search text in the current website', category: 'Current website', keywords: ['search'], shortcut: 'Ctrl/Cmd+F', websiteOnly: true },
  { id: 'reload', label: 'Reload page', description: 'Reload the current website', category: 'Current website', shortcut: 'Ctrl/Cmd+R', websiteOnly: true },
  { id: 'reload-ignoring-cache', label: 'Reload without cache', description: 'Fetch the current website again from the network', category: 'Current website', keywords: ['hard refresh'], shortcut: 'Ctrl/Cmd+Shift+R', websiteOnly: true },
  { id: 'capture-area', label: 'Capture area screenshot', description: 'Select an area and copy its PNG for an agent chat', category: 'Current website', keywords: ['image', 'clipboard', 'snip'], websiteOnly: true },
  { id: 'capture-element', label: 'Capture element screenshot', description: 'Pick one element and copy its complete PNG for an agent chat', category: 'Current website', keywords: ['image', 'clipboard', 'node', 'component'], websiteOnly: true },
  { id: 'capture-viewport', label: 'Capture viewport screenshot', description: 'Copy the visible website as a PNG for an agent chat', category: 'Current website', keywords: ['image', 'clipboard', 'screen', 'visible'], websiteOnly: true },
  { id: 'capture-full-page', label: 'Capture full-page screenshot', description: 'Copy the complete scrollable page as a PNG for an agent chat', category: 'Current website', keywords: ['image', 'clipboard', 'entire', 'long'], websiteOnly: true },
  { id: 'copy-snapshot', label: 'Copy page snapshot for agent', description: 'Copy bounded headings, controls, and visible text for an agent chat', category: 'Current website', keywords: ['clipboard', 'context', 'text', 'accessibility', 'structure'], websiteOnly: true },
  { id: 'pick-element', label: 'Pick element for agent', description: 'Copy safe DOM context from the current website', category: 'Current website', keywords: ['inspect', 'selector'], shortcut: 'Ctrl+Shift+C / Cmd+Option+C', websiteOnly: true },
  { id: 'page-tools', label: 'Open Page tools', description: 'Browse all current-website diagnostics', category: 'Current website', keywords: ['debug'], websiteOnly: true },
  { id: 'site-storage', label: 'Inspect site storage', description: 'Review cookies, databases, workers, and browser storage', category: 'Current website', keywords: ['local storage', 'session storage', 'indexeddb', 'service worker', 'offline', 'pwa'], websiteOnly: true },
  { id: 'responsive-preview', label: 'Open responsive preview', description: 'Test phone, tablet, and desktop viewports', category: 'Current website', keywords: ['mobile', 'viewport'], websiteOnly: true },
  { id: 'environment', label: 'Open Environment', description: 'Emulate network, cache, service workers, CPU, animations, rendering, runtime, region, identity, and location', category: 'Current website', keywords: ['throttle', 'offline', 'slow 3g', 'disable cache', 'bypass cache', 'service worker', 'bypass service worker', 'pwa', 'data saver', 'save data', 'low data', 'pause animations', 'slow animations', 'playback rate', 'disable javascript', 'no js', 'progressive enhancement', 'dark mode', 'print', 'forced colors', 'contrast', 'reduced motion', 'vision deficiency', 'color blindness', 'locale', 'language', 'timezone', 'time zone', 'user agent', 'geolocation'], websiteOnly: true },
  { id: 'console', label: 'Open Console', description: 'Inspect errors, call stacks, and grouped messages', category: 'Current website', keywords: ['logs', 'messages', 'errors', 'warnings', 'exception', 'stack trace', 'source', 'repeat', 'noise'], websiteOnly: true },
  { id: 'network', label: 'Open Network monitor', description: 'Inspect HTTP, WebSocket, timing, and sanitized HAR', category: 'Current website', keywords: ['http', 'api', 'har', 'websocket', 'socket', 'ws'], websiteOnly: true },
  { id: 'request-conditions', label: 'Open Request conditions', description: 'Block, mock, throttle, or prioritize matching website requests temporarily', category: 'Current website', keywords: ['network', 'route', 'override', 'intercept', 'failure', 'timeout', 'priority', 'reorder', 'individual throttle', 'slow api', 'slow request'], websiteOnly: true },
  { id: 'issues', label: 'Open browser issues', description: 'Review security and compatibility diagnostics', category: 'Current website', keywords: ['cors', 'csp', 'cookies'], websiteOnly: true },
  { id: 'debug-report', label: 'Create debug report', description: 'Collect bounded console and failed-request evidence', category: 'Current website', keywords: ['console', 'errors'], websiteOnly: true },
  { id: 'repro-recorder', label: 'Open repro recorder', description: 'Record safe steps for reproducing a problem', category: 'Current website', keywords: ['steps', 'record'], websiteOnly: true },
  { id: 'dom-changes', label: 'Record DOM changes', description: 'See which page structures change after an action', category: 'Current website', keywords: ['mutation', 'html', 'attribute', 'node', 'diff'], websiteOnly: true },
  { id: 'visual-compare', label: 'Open visual compare', description: 'Compare the current page with a baseline', category: 'Current website', keywords: ['diff', 'screenshot'], websiteOnly: true },
  { id: 'quality-audit', label: 'Run quality audit', description: 'Check accessibility, Web Vitals, metadata, security, PWA readiness, and Chromium issues together', category: 'Current website', keywords: ['quality', 'audit', 'seo', 'pwa', 'accessibility', 'performance', 'security'], websiteOnly: true },
  { id: 'accessibility', label: 'Run accessibility audit', description: 'Check the current website against WCAG AA', category: 'Current website', keywords: ['a11y', 'wcag'], websiteOnly: true },
  { id: 'performance', label: 'Measure page performance', description: 'Collect current navigation and rendering metrics', category: 'Current website', keywords: ['speed', 'web vitals'], websiteOnly: true },
  { id: 'design-overview', label: 'Capture design overview', description: 'Review computed colors, typography, and contrast', category: 'Current website', keywords: ['css', 'fonts', 'palette', 'style'], websiteOnly: true },
  { id: 'page-metadata', label: 'Inspect page metadata', description: 'Review search, social, canonical, and structured data signals', category: 'Current website', keywords: ['seo', 'open graph', 'twitter card', 'json-ld', 'robots'], websiteOnly: true },
  { id: 'security', label: 'Inspect connection security', description: 'Review TLS and certificate details for the current page', category: 'Current website', keywords: ['https', 'ssl', 'cipher', 'certificate'], websiteOnly: true },
  { id: 'coverage', label: 'Record code coverage', description: 'Find unused JavaScript and CSS bytes', category: 'Current website', keywords: ['unused code', 'bundle', 'optimize'], websiteOnly: true },
  { id: 'cpu-profile', label: 'Record JavaScript CPU profile', description: 'Find hot JavaScript functions by sampled self time', category: 'Current website', keywords: ['performance', 'profiler', 'hotspot', 'slow function', 'bottom up'], websiteOnly: true },
  { id: 'memory', label: 'Measure page memory', description: 'Inspect heap and DOM counters or sample retained allocations', category: 'Current website', keywords: ['heap', 'dom', 'allocation', 'leak', 'retained'], websiteOnly: true },
  { id: 'developer-tools', label: 'Toggle Developer Tools', description: 'Open Chromium DevTools for the current website', category: 'Current website', keywords: ['inspect', 'console'], shortcut: 'F12', websiteOnly: true },
  { id: 'full-page-view', label: 'Toggle full-page view', description: 'Hide the tabs and toolbar so the website fills the window', category: 'Current website', keywords: ['fullscreen', 'full screen', 'focus', 'distraction', 'hide toolbar', 'immersive', 'zen'], shortcut: 'Ctrl/Cmd+Shift+F', websiteOnly: true },
  { id: 'settings', label: 'Open Settings', description: 'Change Hronaut preferences', category: 'Application', keywords: ['preferences'] },
  { id: 'privacy', label: 'Open Workspaces & data', description: 'Manage profiles, transfer site data, or clear history', category: 'Application', keywords: ['workspace', 'transfer', 'copy', 'move', 'janitor', 'cookies', 'cache'], shortcut: 'Ctrl/Cmd+Shift+Delete' },
  { id: 'site-permissions', label: 'Open Site permissions', description: 'Review saved permission decisions', category: 'Application', keywords: ['camera', 'location', 'notifications'] },
  { id: 'mcp-security', label: 'Open MCP security', description: 'Change authentication and server port', category: 'Application', keywords: ['agent', 'token', 'port'] },
  { id: 'updates', label: 'Check for updates', description: 'Open software update settings', category: 'Application', keywords: ['upgrade', 'version'] },
  { id: 'keyboard-shortcuts', label: 'Show keyboard shortcuts', description: 'Review Hronaut keyboard controls', category: 'Application', keywords: ['help', 'keys'] },
  { id: 'agent-card', label: 'Show agent details', description: 'Open the card of the agent working in this workspace', category: 'Agents', keywords: ['agent', 'status', 'steps', 'claude', 'codex', 'cursor'], shortcut: 'Ctrl/Cmd+.', agentOnly: true },
  { id: 'take-over', label: 'Take over from the agent', description: 'Pause the agent on this tab and carry on yourself', category: 'Agents', keywords: ['agent', 'control', 'pause', 'hand back'], shortcut: 'Ctrl/Cmd+Shift+O', agentOnly: true, websiteOnly: true },
  { id: 'toggle-mcp-pause', label: 'Pause or resume agents', description: 'Control whether Hronaut accepts new MCP commands', category: 'Agents', keywords: ['mcp', 'safety', 'stop'] }
]

/** How the list is divided, in the order it shows when nothing is typed. */
export type CommandPaletteSectionId = 'recent' | 'agents' | 'navigation' | 'website' | 'application'

export interface CommandPaletteSection<T extends CommandPaletteCommand = CommandPaletteCommand> {
  id: CommandPaletteSectionId
  commands: T[]
}

export interface CommandPaletteContext {
  websiteAvailable: boolean
  /** An agent works in the workspace in view: its commands come first. */
  agentActive: boolean
  /** Commands run lately, the latest first. */
  recentIds?: readonly CommandPaletteCommandId[]
}

/** Recent commands listed when nothing is typed. */
export const COMMAND_PALETTE_RECENT_LIMIT = 5

const SECTION_OF_CATEGORY: Record<CommandPaletteCategory, Exclude<CommandPaletteSectionId, 'recent'>> = {
  Agents: 'agents',
  Navigation: 'navigation',
  'Current website': 'website',
  Application: 'application'
}

// By id, since the palette shows commands with their category translated.
const SECTION_OF_COMMAND = new Map<string, Exclude<CommandPaletteSectionId, 'recent'>>(
  COMMAND_PALETTE_COMMANDS.map((command) => [command.id, SECTION_OF_CATEGORY[command.category]])
)

function sectionOf(command: CommandPaletteCommand): Exclude<CommandPaletteSectionId, 'recent'> {
  return SECTION_OF_COMMAND.get(command.id) ?? SECTION_OF_CATEGORY[command.category] ?? 'application'
}

function normalizedWords(value: string): string[] {
  return value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
}

function commandSearchText(command: CommandPaletteCommand): string {
  return [command.label, command.description, command.category, ...(command.keywords ?? [])]
    .join(' ')
    .toLocaleLowerCase()
}

function commandScore(command: CommandPaletteCommand, query: string): number {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) return 0
  const label = command.label.toLocaleLowerCase()
  if (label === normalizedQuery) return 40
  if (label.startsWith(normalizedQuery)) return 30
  if (label.split(/\s+/).some((word) => word.startsWith(normalizedQuery))) return 20
  if (label.includes(normalizedQuery)) return 10
  return 0
}

export function filterCommandPaletteCommands<T extends CommandPaletteCommand = CommandPaletteCommand>(
  query: string,
  websiteAvailable: boolean,
  commands: readonly T[] = COMMAND_PALETTE_COMMANDS as readonly T[]
): T[] {
  const words = normalizedWords(query)
  return commands
    .filter((command) => websiteAvailable || !command.websiteOnly)
    .filter((command) => {
      if (!words.length) return true
      const searchText = commandSearchText(command)
      return words.every((word) => searchText.includes(word))
    })
    .map((command, index) => ({ command, index, score: commandScore(command, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ command }) => command)
}

/**
 * The commands available now, in sections. With nothing typed: recent commands, then the agent's when one works in
 * the workspace in view, then navigation, the current website and the application, with agents last otherwise. With
 * a search, the best match comes first, and each section shows where its best match ranks.
 */
export function commandPaletteSections<T extends CommandPaletteCommand>(
  query: string,
  context: CommandPaletteContext,
  commands: readonly T[] = COMMAND_PALETTE_COMMANDS as readonly T[]
): CommandPaletteSection<T>[] {
  const available = commands.filter((command) => (
    (context.websiteAvailable || !command.websiteOnly) && (context.agentActive || !command.agentOnly)
  ))
  const sections = new Map<CommandPaletteSectionId, T[]>()
  const add = (id: CommandPaletteSectionId, command: T): void => {
    const list = sections.get(id)
    if (list) list.push(command)
    else sections.set(id, [command])
  }
  if (query.trim()) {
    for (const command of filterCommandPaletteCommands(query, true, available)) add(sectionOf(command), command)
    return [...sections].map(([id, list]) => ({ id, commands: list }))
  }
  const recent = (context.recentIds ?? [])
    .map((id) => available.find((command) => command.id === id))
    .filter((command): command is T => command !== undefined)
    .slice(0, COMMAND_PALETTE_RECENT_LIMIT)
  const order: CommandPaletteSectionId[] = context.agentActive
    ? ['recent', 'agents', 'navigation', 'website', 'application']
    : ['recent', 'navigation', 'website', 'application', 'agents']
  for (const command of recent) add('recent', command)
  for (const command of available) if (!recent.includes(command)) add(sectionOf(command), command)
  return order.flatMap((id) => {
    const list = sections.get(id)
    return list ? [{ id, commands: list }] : []
  })
}

const MAC_KEYS: Record<string, string> = { Cmd: '⌘', Shift: '⇧', Option: '⌥', Alt: '⌥', Ctrl: '⌃', Control: '⌃' }

/**
 * A catalog shortcut's keys on this platform, such as ['⌘', '⇧', 'A'] on macOS and ['Ctrl', 'Shift', 'A'] elsewhere.
 * Of alternatives such as 'Ctrl+H / Cmd+Y', the one for this platform.
 */
export function commandShortcutKeys(shortcut: string, mac: boolean): string[] {
  const choices = shortcut.split(' / ')
  const chosen = choices.find((choice) => /(^|\+)(Cmd|Option)(\+|$)/u.test(choice) === mac) ?? choices[0]!
  return chosen.split(/\+(?=.)/u).map((key) => key === 'Ctrl/Cmd' ? (mac ? '⌘' : 'Ctrl') : mac ? MAC_KEYS[key] ?? key : key)
}
