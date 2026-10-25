import { describe, expect, it } from 'vitest'
import { listedTests, planShards, testListLine, testSeconds, unlistable, type ListedTest } from '../scripts/plan-integration-shard.ts'
import { mergedDurations, reportedDurations, serializeDurations } from '../scripts/update-integration-durations.ts'

const test = (title: string, file = 'browser-shell.e2e.ts', describes: string[] = []): ListedTest => ({ file, titlePath: [...describes, title] })

describe('listedTests', () => {
  it('names each listed test by its file, describe titles and title, leaving out untitled describe blocks', () => {
    const tests = listedTests({
      suites: [{
        title: 'themes.e2e.ts',
        specs: [{ title: 'offers themes', file: 'themes.e2e.ts' }],
        suites: [{ title: '', suites: [{ title: 'restart', specs: [{ title: 'keeps > theme', file: 'themes.e2e.ts' }] }] }]
      }]
    })
    expect(tests.map(testListLine)).toEqual(['themes.e2e.ts › offers themes', 'themes.e2e.ts › restart › keeps > theme'])
  })
})

describe('unlistable', () => {
  it('accepts tests a test list selects one by one', () => {
    expect(unlistable([test('opens'), test('opens', 'themes.e2e.ts'), test('closes', 'browser-shell.e2e.ts', ['tabs'])])).toBeUndefined()
  })

  it.each<[string, ListedTest[], string]>([
    ['the list separator', [test('opens › closes')], 'cannot be named in a test list'],
    ['surrounding spaces', [test('opens ')], 'cannot be named in a test list'],
    ['the same title path twice', [test('opens'), test('opens')], 'two tests have the same title path'],
    ['a test whose title path starts another one', [test('tabs'), test('close', 'browser-shell.e2e.ts', ['tabs'])], '"browser-shell.e2e.ts › tabs" also selects "browser-shell.e2e.ts › tabs › close"']
  ])('refuses %s', (_case, tests, problem) => {
    expect(unlistable(tests)).toContain(problem)
  })
})

describe('planShards', () => {
  const tests = Array.from({ length: 40 }, (_, index) => test(`case ${String(index).padStart(2, '0')}`, `file-${index % 7}.e2e.ts`))
  const durations = Object.fromEntries(tests.map((listed, index) => [testListLine(listed), (index * 37) % 50 + 1]))

  it('puts every test in exactly one shard', () => {
    const shards = planShards(tests, durations, 12)
    expect(shards).toHaveLength(12)
    const planned = shards.flatMap((shard) => shard.tests.map(testListLine)).sort()
    expect(planned).toEqual(tests.map(testListLine).sort())
  })

  it('evens out the shards by duration', () => {
    const totals = planShards(tests, durations, 4).map((shard) => shard.seconds)
    const all = Object.values(durations).reduce((sum, seconds) => sum + seconds, 0)
    expect(totals.reduce((sum, seconds) => sum + seconds, 0)).toBe(all)
    // Longest first leaves no shard more than the longest test above the ideal share.
    expect(Math.max(...totals)).toBeLessThanOrEqual(all / 4 + 50)
  })

  it('splits the same way whatever order the tests were listed in', () => {
    const lines = (shards: ReturnType<typeof planShards>) => shards.map((shard) => shard.tests.map(testListLine))
    expect(lines(planShards([...tests].reverse(), durations, 12))).toEqual(lines(planShards(tests, durations, 12)))
  })

  it('counts a test without a recorded duration as the median one', () => {
    expect(testSeconds([test('a'), test('b'), test('c'), test('new')], {
      'browser-shell.e2e.ts › a': 1, 'browser-shell.e2e.ts › b': 5, 'browser-shell.e2e.ts › c': 9, 'browser-shell.e2e.ts › gone': 100
    })).toEqual([1, 5, 9, 5])
    expect(testSeconds([test('a')], {})).toEqual([1])
    expect(testSeconds([test('a'), test('b')], { 'browser-shell.e2e.ts › a': -1, 'browser-shell.e2e.ts › b': 4 })).toEqual([4, 4])
  })

  it('leaves extra shards empty', () => {
    expect(planShards([test('only')], {}, 3).map((shard) => shard.tests.length)).toEqual([1, 0, 0])
  })
})

describe('test durations', () => {
  const result = (status: string, duration: number) => ({ status, duration })

  it('records the last passing attempt of each test in seconds', () => {
    expect(reportedDurations([{
      suites: [{
        title: 'themes.e2e.ts',
        specs: [
          { title: 'flaky', file: 'themes.e2e.ts', tests: [{ results: [result('failed', 45_000), result('passed', 2_340)] }] },
          { title: 'failed', file: 'themes.e2e.ts', tests: [{ results: [result('failed', 3_000), result('timedOut', 45_000)] }] },
          { title: 'skipped', file: 'themes.e2e.ts', tests: [{ results: [result('skipped', 0)] }] }
        ],
        suites: [{ title: '', suites: [{ title: 'restart', specs: [{ title: 'keeps', file: 'themes.e2e.ts', tests: [{ results: [result('passed', 12_049)] }] }] }] }]
      }]
    }])).toEqual({ 'themes.e2e.ts › flaky': 2.3, 'themes.e2e.ts › failed': 45, 'themes.e2e.ts › restart › keeps': 12 })
  })

  it('adds a run to the recorded durations, or replaces them with a run of the whole suite', () => {
    const recorded = { 'b.e2e.ts › kept': 3, 'a.e2e.ts › changed': 1 }
    const run = { 'a.e2e.ts › changed': 2, 'c.e2e.ts › new': 4 }
    expect(Object.entries(mergedDurations(recorded, run, false))).toEqual([['a.e2e.ts › changed', 2], ['b.e2e.ts › kept', 3], ['c.e2e.ts › new', 4]])
    expect(mergedDurations(recorded, run, true)).toEqual(run)
  })

  it('writes one test per line', () => {
    expect(serializeDurations({ 'a.e2e.ts › one': 1.5, 'a.e2e.ts › "two"': 2 })).toBe('{\n  "a.e2e.ts › one": 1.5,\n  "a.e2e.ts › \\"two\\"": 2\n}\n')
    expect(JSON.parse(serializeDurations({ 'a.e2e.ts › one': 1.5 }))).toEqual({ 'a.e2e.ts › one': 1.5 })
    expect(serializeDurations({})).toBe('{}\n')
  })
})
