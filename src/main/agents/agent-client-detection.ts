import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { AGENT_GUIDE_IDS, type AgentGuideId } from '../../shared/agent-guides.js'

/** Folders each agent keeps in the home folder on every platform. Existence only: nothing is read or run. */
const AGENT_CLIENT_PATHS: Partial<Record<AgentGuideId, string[]>> = {
  codex: ['.codex'],
  'claude-code': ['.claude.json', '.claude'],
  cursor: ['.cursor'],
  'gemini-cli': ['.gemini'],
  kiro: ['.kiro'],
  'jetbrains-junie': ['.junie'],
  'mistral-vibe': ['.vibe'],
  warp: ['.warp'],
  windsurf: [join('.codeium', 'windsurf')],
  'grok-build': ['.grok'],
  'qwen-code': ['.qwen']
}

const exists = (path: string): Promise<boolean> => access(path).then(() => true, () => false)

/** The agents that look installed, in the guides' order. `extra` adds paths, such as Claude Code's settings file. */
export async function detectAgentClients(home = homedir(), extra: Partial<Record<AgentGuideId, string[]>> = {}): Promise<AgentGuideId[]> {
  const found = await Promise.all(AGENT_GUIDE_IDS.map(async id => {
    const paths = [...(AGENT_CLIENT_PATHS[id] ?? []).map(path => join(home, path)), ...(extra[id] ?? [])]
    for (const path of paths) if (await exists(path)) return true
    return false
  }))
  return AGENT_GUIDE_IDS.filter((_, index) => found[index])
}
