import { parentPort } from 'node:worker_threads'
import { summarizeHeapSnapshot, type HeapSnapshotCounts } from './heap-snapshot-summary.ts'

// Parses one heap snapshot off the main process: a snapshot of a large app is hundreds of megabytes of JSON, which
// would stop the window and every agent for seconds. Main sends the chunks as Chromium streams them, then 'end'.

export type HeapSnapshotWorkerRequest = { chunk: string } | { end: true }
export type HeapSnapshotWorkerReply = { summary: HeapSnapshotCounts } | { error: string }

const chunks: string[] = []

parentPort?.on('message', (request: HeapSnapshotWorkerRequest) => {
  if ('chunk' in request) {
    chunks.push(request.chunk)
    return
  }
  let reply: HeapSnapshotWorkerReply
  try {
    const text = chunks.join('')
    chunks.length = 0
    reply = { summary: summarizeHeapSnapshot(JSON.parse(text)) }
  } catch (error) {
    reply = { error: error instanceof Error ? error.message : String(error) }
  }
  parentPort?.postMessage(reply)
})
