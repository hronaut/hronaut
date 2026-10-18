import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/server.js'

const toolsDirectory = 'src/main/mcp/tools'
const folderFor = (toolName: string): string => `${toolsDirectory}/${toolName.replaceAll('_', '-')}`
// The session's MCP server with its call wrapper, and the workspace wrapper it builds.
const wrapperSources = (): [string, string] => [readFileSync('src/main/mcp/browser-mcp-server.ts', 'utf8'), readFileSync('src/main/mcp/workspace-tool-call.ts', 'utf8')]

describe('MCP tool folders', () => {
  it('keeps every advertised tool in its own folder, registering only that tool', () => {
    for (const { name } of BROWSER_TOOL_CATALOG) {
      const file = `${folderFor(name)}/index.ts`
      expect(existsSync(file), file).toBe(true)
      const registered = [...readFileSync(file, 'utf8').matchAll(/^ {2}register(?:Workspace)?Tool\(\n {4}'([a-z_]+)'/gmu)].map(match => match[1])
      expect(registered, file).toEqual([name])
    }
  })

  it('has no folder for a tool the catalog does not advertise', () => {
    const folders = readdirSync(toolsDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
    expect(folders.sort()).toEqual(BROWSER_TOOL_CATALOG.map(({ name }) => name.replaceAll('_', '-')).sort())
  })

  it('leaves the browser MCP server registering tools only through their folders', () => {
    const server = readFileSync('src/main/mcp/browser-mcp-server.ts', 'utf8')
    expect(server).not.toMatch(/^\s+register(?:Workspace)?Tool\(\n\s+'(?:browser|wallet)_/mu)
    const calls = [...server.matchAll(/^ {2}(register(?:Browser|Wallet)\w+)\(toolContext\)$/gmu)].map(match => match[1])
    expect(calls).toHaveLength(BROWSER_TOOL_CATALOG.length)
  })

  it('lets each tool build its own call hooks instead of the shared wrappers adding them by tool name', () => {
    const server = wrapperSources().join('\n')
    const hooks = ['validateInspection', 'validateNativeInput', 'storageComparisonHooks', 'storageInspectionHooks', 'webStorageHooks',
      'cookieWriteHooks', 'validateConditions', 'markConditionsSubmitted', 'markWheelAttempted', 'retainClickAuthority', 'recordClickProgress',
      'holdSignal', 'recordHoldProgress', 'retainSelection', 'markSelectionSubmitted', 'validateSelect', 'fileEvaluationSignal',
      'validateFileEvaluation', 'validateUpload', 'validateExport', 'reactAuthority', 'validateCapture', 'validateRecording', 'recordingSignal']
    expect(hooks.filter(hook => new RegExp(`\\b${hook}\\b`, 'u').test(server))).toEqual([])
    expect(server).toMatch(/await handler\(\{ \.\.\.actionInput, tabId: resolvedTabId \} as unknown as T, call\)/u)
  })

  it('keeps tool names out of the shared call wrappers, which read each tool\'s options and settlement instead', () => {
    // Whole files and any quote style, so a name list cannot come back at module level or in another literal form.
    const wrappers = wrapperSources().join('\n')
    expect([...wrappers.matchAll(/['"`](?:browser|wallet)_[a-z_]+/gu)].map(match => match[0])).toEqual([])
  })
})
