import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { build, type Rolldown } from 'vite'
import { describe, expect, it } from 'vitest'

// Page functions ship as the bundler prints them. A direct eval in one would run its script in the function's own
// scope, where the script sees the function's parameters and locals; Rolldown turned eval called through a local
// binding into exactly that, so the bundled output is checked, not the TypeScript.

const pageFiles = (readdirSync('src', { recursive: true }) as string[])
  .filter(file => file.endsWith('.page.ts'))
  .map(file => join('src', file))
  .sort()

async function bundled(entries: string[]): Promise<string> {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: entries, formats: ['es'] } }
  })
  const outputs = (Array.isArray(result) ? result : [result]) as Rolldown.RolldownOutput[]
  return outputs.flatMap(output => output.output).map(chunk => chunk.type === 'chunk' ? chunk.code : '').join('\n')
}

describe('bundled page functions', () => {
  it('evaluate a script only through an indirect eval', async () => {
    expect(pageFiles.length).toBeGreaterThan(0)
    const code = await bundled(pageFiles)
    expect(code).toContain('return await (0, eval)(script);')
    expect(code.replaceAll('(0, eval)(', '').match(/(?<![.\w$])eval\s*\(/g)).toBeNull()
  }, 60_000)
})
