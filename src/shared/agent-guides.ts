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

export function isAgentGuideId(value: unknown): value is AgentGuideId {
  return typeof value === 'string' && (AGENT_GUIDE_IDS as readonly string[]).includes(value)
}
