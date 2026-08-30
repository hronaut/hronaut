const BASE_INTEGRATION_MCP_PORT = 48_700
const SHARD_PORT_STRIDE = 100

export function integrationMcpPort(rawShardIndex: string | undefined, workerIndex: number): number {
  const shardIndex = Number.parseInt(rawShardIndex ?? '0', 10)
  const safeShardIndex = Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex <= 8
    ? shardIndex
    : 0
  return BASE_INTEGRATION_MCP_PORT + safeShardIndex * SHARD_PORT_STRIDE + workerIndex
}
