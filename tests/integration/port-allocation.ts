// Keep listeners below the measured Docker QA ephemeral range (32768–60999).
// Reserve enough distinct worker/retry slots without crossing another shard.
const BASE_INTEGRATION_MCP_PORT = 18_000
const SHARD_PORT_STRIDE = 1_000

export function integrationMcpPort(rawShardIndex: string | undefined, workerIndex: number): number {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= SHARD_PORT_STRIDE) {
    throw new RangeError('Integration worker index must be between 0 and 999')
  }
  const shardIndex = Number.parseInt(rawShardIndex ?? '0', 10)
  const safeShardIndex = Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex <= 8
    ? shardIndex
    : 0
  return BASE_INTEGRATION_MCP_PORT + safeShardIndex * SHARD_PORT_STRIDE + workerIndex
}
