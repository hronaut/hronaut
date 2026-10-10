import { readFileSync } from 'node:fs'
const expected = readFileSync('scripts/diagnostics/capture-order.txt', 'utf8').trim().split('\n')
const actual: string[] = []
function walk(value: { specs?: { file: string; title: string }[]; suites?: Parameters<typeof walk>[0][] }): void {
  for (const spec of value.specs ?? []) actual.push(`[electron] › ${spec.file} › ${spec.title}`)
  for (const suite of value.suites ?? []) walk(suite)
}
walk(JSON.parse(readFileSync(process.argv[2]!, 'utf8')))
if (expected.length !== 133 || JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error('Original shard-2 collection differs; experiment blocked')
}
