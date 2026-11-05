import { AsyncLocalStorage } from 'node:async_hooks'

interface AgentCall { running: boolean }

const agentCalls = new AsyncLocalStorage<AgentCall>()

/**
 * Runs an agent's tool call. What the call reads of the browser state goes back to the agent, never to the shell as
 * an action's reply, so its reads leave the shell's publications to their own pace (see StatePublication.beforeRead).
 */
export async function runAgentCall<T>(call: () => Promise<T>): Promise<T> {
  const context: AgentCall = { running: true }
  return agentCalls.run(context, async () => {
    try {
      return await call()
    } finally {
      // A callback the call left behind keeps its context after the call returned, and what it reads may be for the
      // shell, as when a person's action waits on a page the agent opened.
      context.running = false
    }
  })
}

/** Whether this code runs for an agent's tool call that has not returned yet. */
export function inAgentCall(): boolean {
  return agentCalls.getStore()?.running === true
}
