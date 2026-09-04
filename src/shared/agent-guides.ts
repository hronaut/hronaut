export const AGENT_GUIDE_IDS = [
  'codex',
  'claude-code',
  'cursor',
  'vscode',
  'opencode',
  'gemini-cli',
  'goose',
  'cline',
  'zoo-code',
  'kiro',
  'kilo',
  'jetbrains-junie',
  'devin-local',
  'zed',
  'mistral-vibe',
  'warp',
  'windsurf',
  'grok-build',
  'qwen-code',
  'generic'
] as const

export type AgentGuideId = typeof AGENT_GUIDE_IDS[number]

export const AGENT_GUIDE_NAMES = {
  codex: 'Codex',
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  vscode: 'VS Code / GitHub Copilot',
  opencode: 'OpenCode',
  'gemini-cli': 'Gemini CLI',
  goose: 'Goose',
  cline: 'Cline',
  'zoo-code': 'Zoo Code',
  kiro: 'Kiro',
  kilo: 'Kilo Code',
  'jetbrains-junie': 'JetBrains Junie',
  'devin-local': 'Devin Local',
  zed: 'Zed',
  'mistral-vibe': 'Mistral Vibe',
  warp: 'Warp',
  windsurf: 'Windsurf',
  'grok-build': 'Grok Build',
  'qwen-code': 'Qwen Code',
  generic: 'Generic MCP client'
} as const satisfies Record<AgentGuideId, string>

export function isAgentGuideId(value: unknown): value is AgentGuideId {
  return typeof value === 'string' && (AGENT_GUIDE_IDS as readonly string[]).includes(value)
}
