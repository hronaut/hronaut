import type { AgentGuideId } from './agent-guides.js'

/** What Claude Code's settings file says about Hronaut, read in main without running Claude Code. */
export type ClaudeCodeSetupState = 'not-found' | 'unreadable' | 'not-configured' | 'configured' | 'other-address'

export interface ClaudeCodeSetupStatus {
  state: ClaudeCodeSetupState
  /** The settings file Hronaut reads and would change, as Home shows it. */
  path: string
}

/** The exact change Home shows before the person confirms it in a native dialog. */
export interface ClaudeCodeSetupPreview {
  /** Single use, for this page, for two minutes. */
  planId: string
  path: string
  /** Hronaut's current entry as JSON, when it points elsewhere. */
  before: string | null
  after: string
  backupName: string
}

export type ClaudeCodeSetupResult = { outcome: 'applied'; backupName: string } | { outcome: 'cancelled' }

/** Agents found on this computer by fixed paths, and Claude Code's setup when Hronaut can offer it. */
export interface HomeSetupState {
  detected: AgentGuideId[]
  /** Absent while MCP authentication is on: Hronaut never writes a token into another app's settings. */
  claudeCode?: ClaudeCodeSetupStatus
}

export const CLAUDE_CODE_SETUP_ERRORS = ['not-found', 'unreadable', 'configured', 'expired', 'changed', 'busy', 'write-failed'] as const
export type ClaudeCodeSetupErrorCode = typeof CLAUDE_CODE_SETUP_ERRORS[number]

/** Main's reason for a refused setup, from an IPC error's message, which carries only the code. */
export function claudeCodeSetupErrorCode(error: unknown): ClaudeCodeSetupErrorCode | null {
  const code = /claude-code-setup:([a-z-]+)/u.exec(error instanceof Error ? error.message : String(error))?.[1]
  return CLAUDE_CODE_SETUP_ERRORS.find(known => known === code) ?? null
}
