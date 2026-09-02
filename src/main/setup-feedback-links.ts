import { isAgentGuideId, type AgentGuideId } from '../shared/agent-guides.js'

export const SETUP_FEEDBACK_URL = 'https://hronaut.dev/go/desktop-setup-feedback'
export const SETUP_HELP_URL = 'https://hronaut.dev/go/desktop-setup-help'

export const AGENT_GUIDE_URLS = Object.freeze({
  codex: 'https://hronaut.dev/codex-browser-mcp',
  'claude-code': 'https://hronaut.dev/claude-code-browser-mcp',
  cursor: 'https://hronaut.dev/cursor-browser-mcp',
  vscode: 'https://hronaut.dev/github-copilot-browser-mcp',
  opencode: 'https://hronaut.dev/opencode-browser-mcp',
  'gemini-cli': 'https://hronaut.dev/gemini-cli-browser-mcp',
  cline: 'https://hronaut.dev/cline-browser-mcp',
  kiro: 'https://hronaut.dev/kiro-browser-mcp',
  kilo: 'https://hronaut.dev/kilo-code-browser-mcp',
  'jetbrains-junie': 'https://hronaut.dev/jetbrains-junie-browser-mcp',
  'devin-local': 'https://hronaut.dev/devin-local-browser-mcp',
  zed: 'https://hronaut.dev/zed-browser-mcp',
  'mistral-vibe': 'https://hronaut.dev/mistral-vibe-browser-mcp',
  warp: 'https://hronaut.dev/warp-browser-mcp',
  windsurf: 'https://hronaut.dev/setup#client-configurations',
  generic: 'https://hronaut.dev/setup#client-configurations'
} as const satisfies Readonly<Record<AgentGuideId, `https://hronaut.dev/${string}`>>)

function fixedExternalLinkHandler<Event>(
  url: string,
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return async (event: Event): Promise<void> => {
    assertTrustedSender(event)
    await openExternal(url)
  }
}

export function setupFeedbackHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return fixedExternalLinkHandler(SETUP_FEEDBACK_URL, assertTrustedSender, openExternal)
}

export function setupHelpHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event) => Promise<void> {
  return fixedExternalLinkHandler(SETUP_HELP_URL, assertTrustedSender, openExternal)
}

export function agentGuideHandler<Event>(
  assertTrustedSender: (event: Event) => void,
  openExternal: (url: string) => Promise<unknown>
): (event: Event, clientId: unknown) => Promise<void> {
  return async (event: Event, clientId: unknown): Promise<void> => {
    assertTrustedSender(event)
    if (!isAgentGuideId(clientId)) {
      throw new TypeError('Invalid Hronaut Home agent guide ID')
    }
    await openExternal(AGENT_GUIDE_URLS[clientId])
  }
}
