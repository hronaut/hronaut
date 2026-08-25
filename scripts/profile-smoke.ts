import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { useMcpWorkspace } from './mcp-workspace.js'

type ProfilePhase = 'write' | 'read' | 'cleanup'

interface ProfileResult {
  storage: string | null
  cookie: string
}

const phase = process.argv[2]
if (phase !== 'write' && phase !== 'read' && phase !== 'cleanup') {
  throw new Error('Use phase "write", "read", or "cleanup".')
}
const typedPhase: ProfilePhase = phase

const endpoint = new URL(process.env.HRONAUT_MCP_URL || 'http://127.0.0.1:47812/mcp')
const pageUrl = process.env.HRONAUT_PROFILE_SMOKE_URL || 'http://127.0.0.1:47813/'
const token = process.env.HRONAUT_MCP_TOKEN
const client = new Client({ name: 'hronaut-profile-smoke', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(endpoint, {
  ...(token ? { requestInit: { headers: { authorization: `Bearer ${token}` } } } : {})
}))
const workspaceId = await useMcpWorkspace(client, 'Profile smoke', true, typedPhase !== 'write')

function text(result: CallToolResult): string {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

try {
  const navigation = await client.callTool({ name: 'browser_navigate', arguments: { url: pageUrl } }) as CallToolResult
  if (navigation.isError) throw new Error(text(navigation))

  const script =
    typedPhase === 'write'
      ? `(() => {
          localStorage.setItem('hronaut.profile-smoke', 'persisted');
          document.cookie = 'hronaut_profile_smoke=persisted; Path=/; Max-Age=3600; SameSite=Lax';
          return { storage: localStorage.getItem('hronaut.profile-smoke'), cookie: document.cookie };
        })()`
      : typedPhase === 'read'
        ? `(() => ({
          storage: localStorage.getItem('hronaut.profile-smoke'),
          cookie: document.cookie
        }))()`
        : `(() => {
            localStorage.removeItem('hronaut.profile-smoke');
            document.cookie = 'hronaut_profile_smoke=; Path=/; Max-Age=0; SameSite=Lax';
            return { storage: localStorage.getItem('hronaut.profile-smoke'), cookie: document.cookie };
          })()`
  const evaluated = await client.callTool({ name: 'browser_evaluate', arguments: { script } }) as CallToolResult
  if (evaluated.isError) throw new Error(text(evaluated))
  const result = JSON.parse(text(evaluated)) as ProfileResult
  if (typedPhase !== 'cleanup' && (result.storage !== 'persisted' || !result.cookie.includes('hronaut_profile_smoke=persisted'))) {
    throw new Error(`Persistent profile check failed: ${JSON.stringify(result)}`)
  }
  if (typedPhase === 'cleanup') {
    const closed = await client.callTool({
      name: 'browser_workspaces',
      arguments: { action: 'close', workspaceId }
    }) as CallToolResult
    if (closed.isError) throw new Error(text(closed))
    console.log('Persistent profile smoke data and its workspace were removed.')
  } else {
    console.log(`Persistent profile ${typedPhase} phase passed: localStorage and cookie are present.`)
  }
} finally {
  await client.close()
}
