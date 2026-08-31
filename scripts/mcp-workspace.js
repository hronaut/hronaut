function text(result) {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

export async function connectMcpWorkspace(client, name, ensureTab = true, resume) {
  const callTool = client.callTool.bind(client)
  const result = await callTool({
    name: 'browser_workspaces',
    arguments: resume
      ? { action: 'resume', workspaceId: resume.workspaceId, resumeKey: resume.resumeKey }
      : { action: 'create', name }
  })
  if (result.isError) throw new Error(text(result))
  const workspace = JSON.parse(text(result))

  const workspaceId = workspace.id
  client.callTool = (request, ...rest) => callTool(
    request.name === 'browser_workspaces'
      ? request
      : { ...request, arguments: { ...(request.arguments ?? {}), workspaceId } },
    ...rest
  )

  if (ensureTab && workspace.tabCount === 0) {
    const opened = await client.callTool({ name: 'browser_new_tab', arguments: { active: true } })
    if (opened.isError) throw new Error(text(opened))
    const ready = await client.callTool({ name: 'browser_wait', arguments: { timeoutMs: 5_000 } })
    if (ready.isError) throw new Error(text(ready))
  }
  return { workspaceId, resumeKey: workspace.resumeKey }
}

export async function useMcpWorkspace(client, name, ensureTab = true) {
  return (await connectMcpWorkspace(client, name, ensureTab)).workspaceId
}
