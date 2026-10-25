// Keep listeners below the measured Docker QA ephemeral range (32768–60999).
// Reserve enough distinct worker/retry slots without crossing another shard.
const BASE_INTEGRATION_MCP_PORT = 18_000
const SHARD_PORT_STRIDE = 500
/** Hosted CI runs shards 1 through 12; 0 is an unsharded run. */
const MAX_SHARD = 12
// The trace self-test starts a separate Playwright process whose worker indices
// restart at zero. Its listeners must not share the parent suite's reserved slots.
const TRACE_FIXTURE_PORT_BASE = BASE_INTEGRATION_MCP_PORT + (MAX_SHARD + 1) * SHARD_PORT_STRIDE
// Busy-port cases occupy their MCP port, and Hronaut then offers the first free port up to 20 above it. Each worker gets
// a block of its own above every reserved slot, so neither the occupied port nor the offer can be another worker's.
const BUSY_PORT_BASE = TRACE_FIXTURE_PORT_BASE + SHARD_PORT_STRIDE
/** The occupied port and the 20 above it that Hronaut may offer, rounded up. */
export const BUSY_PORT_BLOCK = 32
const BUSY_PORT_WORKER_SLOTS = 16

function safeShard(rawShardIndex: string | undefined): number {
  const shardIndex = Number.parseInt(rawShardIndex ?? '0', 10)
  return Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex <= MAX_SHARD ? shardIndex : 0
}

function assertWorkerIndex(workerIndex: number): void {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= SHARD_PORT_STRIDE) {
    throw new RangeError(`Integration worker index must be between 0 and ${SHARD_PORT_STRIDE - 1}`)
  }
}

export function integrationMcpPort(rawShardIndex: string | undefined, workerIndex: number, namespace = 'suite'): number {
  assertWorkerIndex(workerIndex)
  if (namespace === 'trace-fixtures') return TRACE_FIXTURE_PORT_BASE + workerIndex
  if (namespace !== 'suite') throw new RangeError('Unknown integration MCP port namespace')
  return BASE_INTEGRATION_MCP_PORT + safeShard(rawShardIndex) * SHARD_PORT_STRIDE + workerIndex
}

/**
 * The MCP port a busy-port case occupies before launching Hronaut on it, from Playwright's `parallelIndex`, which
 * differs between workers running at the same time and stays below the worker count (at most 8 here).
 */
export function integrationBusyMcpPort(rawShardIndex: string | undefined, parallelIndex: number): number {
  if (!Number.isInteger(parallelIndex) || parallelIndex < 0 || parallelIndex >= BUSY_PORT_WORKER_SLOTS) {
    throw new RangeError(`Integration parallel index must be between 0 and ${BUSY_PORT_WORKER_SLOTS - 1}`)
  }
  return BUSY_PORT_BASE + (safeShard(rawShardIndex) * BUSY_PORT_WORKER_SLOTS + parallelIndex) * BUSY_PORT_BLOCK
}
