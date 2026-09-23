import { describe, expect, it } from 'vitest'
import {
  BROWSER_SERVER_INSTRUCTIONS,
  BROWSER_TOOL_CATALOG
} from '../src/main/mcp/server.js'

describe('MCP workspace guidance', () => {
  const description = BROWSER_TOOL_CATALOG.find((tool) => tool.name === 'browser_workspaces')?.description

  it('advertises only scratch and explicit workspace forks', () => {
    expect(description).toContain('Start with action=list to see existing workspaces marked forkOnly')
    expect(description).toContain('action=create to make a fresh task workspace')
    expect(description).toContain('Creation choice 1 — from scratch: storage=scratch')
    expect(description).toContain('Creation choice 2 — fork a workspace')
    expect(description).toContain('action=list includes metadata-only entries marked forkOnly')
    expect(description).toContain('contextClass=public-observer')
    expect(description).toContain('blocks page mutation tools')
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
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('metadata-only forkOnly sources')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('Never browse another workspace')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_snapshot and browser_find')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_snapshot action=assess-quality')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_public_outcome')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('writer read-back')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('set a browser_snapshot baseline and request bounded deltas')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('fresh baseline after any invalidation')
    expect(BROWSER_SERVER_INSTRUCTIONS).toContain('browser_request_user_attention only when')
  })

  it('explains how to fork archived workspaces from the saved list', () => {
    const savedDescription = BROWSER_TOOL_CATALOG.find((tool) => tool.name === 'browser_saved_workspaces')?.description
    expect(savedDescription).toContain('metadata-only forkOnly sources')
    expect(savedDescription).toContain('direct agent access disabled')
    expect(savedDescription).toContain('storage=fork-workspace and sourceWorkspaceId')
  })
})
