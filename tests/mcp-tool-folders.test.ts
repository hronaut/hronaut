import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BROWSER_TOOL_CATALOG } from '../src/main/mcp/server.js'

const toolsDirectory = 'src/main/mcp/tools'
const folderFor = (toolName: string): string => `${toolsDirectory}/${toolName.replaceAll('_', '-')}`

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

  it('leaves server.ts registering tools only through their folders', () => {
    const server = readFileSync('src/main/mcp/server.ts', 'utf8')
    expect(server).not.toMatch(/^\s+register(?:Workspace)?Tool\(\n\s+'(?:browser|wallet)_/mu)
    const calls = [...server.matchAll(/^ {2}(register(?:Browser|Wallet)\w+)\(toolContext\)$/gmu)].map(match => match[1])
    expect(calls).toHaveLength(BROWSER_TOOL_CATALOG.length)
  })
})
