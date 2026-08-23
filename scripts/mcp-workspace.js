function text(result) {
  const content = result.content.find((item) => item.type === 'text')
  return content?.type === 'text' ? content.text : ''
}

export async function useMcpWorkspace(client, name, ensureTab = true) {
  const callTool = client.callTool.bind(client)
  const created = await callTool({ name: 'browser_workspaces', arguments: { action: 'create', name } })
  if (created.isError) throw new Error(text(created))
  const workspace = JSON.parse(text(created))

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
  return workspaceId
}
