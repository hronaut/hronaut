import { describe, expect, it } from 'vitest'
import {
  BROWSER_SERVER_INSTRUCTIONS,
  BROWSER_TOOL_CATALOG
} from '../src/main/mcp/server.js'

describe('MCP workspace guidance', () => {
  const description = BROWSER_TOOL_CATALOG.find((tool) => tool.name === 'browser_workspaces')?.description

  it('presents scratch, fork-Default, and optional merge-back as one explicit lifecycle', () => {
    expect(description).toContain('Required first step: call browser_workspaces with action=create')
    expect(description).toContain('Creation choice 1 — from scratch: storage=scratch')
    expect(description).toContain('Creation choice 2 — fork Default: storage=fork-default')
    expect(description).toContain('Optional merge-back: after the task, call action=save-default')
    expect(description).toContain('This is a copy, not a live link')
    expect(description).toContain('never ongoing synchronization')
  })

  it('publishes valid call examples and never directs agents to use Default itself', () => {
    const examples = [...(description?.matchAll(/Example: (\{[^\n]+\})\./g) ?? [])]
      .map((match) => JSON.parse(match[1]!))

    expect(examples).toEqual([
      { action: 'create', name: 'Task name', storage: 'scratch' },
      { action: 'create', name: 'Task name', storage: 'fork-default' },
      { action: 'save-default', workspaceId: '<id returned by create>' }
    ])
    expect(description).toContain('must never pass the workspace marked isDefault to page tools')
    expect(description).not.toContain('Its stable id')
  })

  it('advertises the cross-tool workflow during MCP initialization', () => {
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('persist after this MCP client disconnects')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('create a fresh isolated workspace')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('Never browse in Default')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_snapshot and browser_find')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_request_user_attention only when')
  })
})
