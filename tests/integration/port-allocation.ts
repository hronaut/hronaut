// Keep listeners below the measured Docker QA ephemeral range (32768–60999).
// Reserve enough distinct worker/retry slots without crossing another shard.
const BASE_INTEGRATION_MCP_PORT = 18_000
const SHARD_PORT_STRIDE = 1_000
// The trace self-test starts a separate Playwright process whose worker indices
// restart at zero. Its listeners must not share the parent suite's reserved slots.
const TRACE_FIXTURE_PORT_BASE = BASE_INTEGRATION_MCP_PORT + 9 * SHARD_PORT_STRIDE

export function integrationMcpPort(rawShardIndex: string | undefined, workerIndex: number, namespace = 'suite'): number {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= SHARD_PORT_STRIDE) {
    throw new RangeError('Integration worker index must be between 0 and 999')
  }
  if (namespace === 'trace-fixtures') return TRACE_FIXTURE_PORT_BASE + workerIndex
  if (namespace !== 'suite') throw new RangeError('Unknown integration MCP port namespace')
  const shardIndex = Number.parseInt(rawShardIndex ?? '0', 10)
  const safeShardIndex = Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex <= 8
    ? shardIndex
    : 0
  return BASE_INTEGRATION_MCP_PORT + safeShardIndex * SHARD_PORT_STRIDE + workerIndex
}
