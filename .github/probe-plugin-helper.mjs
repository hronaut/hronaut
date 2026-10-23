// Temporary probe: runs the plugin's headersHelper with the system shell, as Claude Code does.
import { exec } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const manifest = JSON.parse(readFileSync('plugins/hronaut/.claude-plugin/plugin.json', 'utf8'))
const root = join(process.cwd(), 'plugins', 'hronaut')
const command = manifest.mcpServers.hronaut.headersHelper.replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
const profile = mkdtempSync(join(tmpdir(), 'probe-'))
const token = 'a'.repeat(20) + '-_B9'.repeat(5)
writeFileSync(join(profile, 'mcp-token'), `﻿${token}\r\n`)
const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH')
const separator = process.platform === 'win32' ? ';' : ':'
const withoutSh = process.env[pathKey].split(separator).filter((entry) => !/[\\/](usr[\\/])?bin[\\/]?$/i.test(entry) || !/git|msys/i.test(entry)).join(separator)
console.log('command:', command)
function run(label, overrides, line = command) {
  const env = { ...process.env, ...overrides }
  return new Promise((done) => exec(line, { env, timeout: 30000 }, (error, stdout, stderr) => {
    console.log(label, JSON.stringify({ code: error ? error.code : 0, stdout, stderr }))
    done()
  }))
}
const started = Date.now()
await run('without-sh', { [pathKey]: withoutSh, HRONAUT_USER_DATA_DIR: profile })
console.log('ms', Date.now() - started)
await run('where-sh-without', { [pathKey]: withoutSh }, process.platform === 'win32' ? 'where sh' : 'command -v sh')
await run('with-path', { HRONAUT_USER_DATA_DIR: profile })
await run('bad-port', { [pathKey]: withoutSh, HRONAUT_USER_DATA_DIR: profile, HRONAUT_MCP_PORT: '1@attacker.example:8080' })
await run('missing', { [pathKey]: withoutSh, HRONAUT_USER_DATA_DIR: join(profile, 'missing') })
await run('appdata-default', { [pathKey]: withoutSh })
