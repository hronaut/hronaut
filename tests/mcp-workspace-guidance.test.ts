import { describe, expect, it } from 'vitest'
import {
  BROWSER_SERVER_INSTRUCTIONS,
  BROWSER_TOOL_CATALOG
} from '../src/main/mcp/server.js'

describe('MCP workspace guidance', () => {
  const description = BROWSER_TOOL_CATALOG.find((tool) => tool.name === 'browser_workspaces')?.description

  it('advertises only scratch and explicit workspace forks', () => {
    expect(description).toContain('Required first step: call browser_workspaces with action=create')
    expect(description).toContain('Creation choice 1 — from scratch: storage=scratch')
    expect(description).toContain('Creation choice 2 — fork a workspace')
    for (const removed of ['fork-default', 'import-default', 'save-default', 'isDefault']) expect(description).not.toContain(removed)
    const examples = [...(description?.matchAll(/Example: (\{[^\n]+\})\./g) ?? [])].map(match => JSON.parse(match[1]!))
    expect(examples).toEqual([
      { action: 'create', name: 'Task name', storage: 'scratch' },
      { action: 'create', name: 'Task name', storage: 'fork-workspace', sourceWorkspaceId: '<id from list-fork-sources>' }
    ])
    expect(description).toContain('inherits source navigation restrictions')
  })

  it('advertises the cross-tool workflow during MCP initialization', () => {
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('persist after this MCP client disconnects')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('create a fresh isolated workspace')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('Never browse another workspace')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_snapshot and browser_find')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_request_user_attention only when')
  })
})
