import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

describe('CodeQL workflow', () => {
  it('analyzes application and workflow code with bounded permissions', async () => {
    const source = await readFile('.github/workflows/codeql.yml', 'utf8')
    const workflow = parse(source) as {
      on: Record<string, unknown>
      permissions: Record<string, string>
      concurrency: Record<string, unknown>
      jobs: Record<string, {
        permissions: Record<string, string>
        strategy: { matrix: { language: string[] } }
        steps: Array<{ uses?: string; with?: Record<string, string> }>
      }>
    }
    const analyze = workflow.jobs.analyze
    expect(analyze).toBeDefined()
    if (!analyze) throw new Error('CodeQL analyze job is missing')

    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'schedule', 'workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toMatchObject({ 'cancel-in-progress': true })
    expect(analyze.permissions).toEqual({
      actions: 'read',
      contents: 'read',
      'security-events': 'write'
    })
    expect(analyze.strategy.matrix.language).toEqual(['actions', 'javascript-typescript'])
    expect(analyze.steps.map((step) => step.uses).filter(Boolean)).toEqual([
      'actions/checkout@v7',
      'github/codeql-action/init@v4',
      'github/codeql-action/analyze@v4'
    ])
    expect(analyze.steps.find((step) => step.uses === 'github/codeql-action/init@v4')?.with)
      .toEqual({ languages: '${{ matrix.language }}' })
  })

  it('publishes the CodeQL status beside the primary CI badge', async () => {
    const readme = await readFile('README.md', 'utf8')
    const ciBadge = readme.indexOf('actions/workflows/ci.yml/badge.svg?branch=main')
    const codeQlBadge = readme.indexOf('actions/workflows/codeql.yml/badge.svg?branch=main')
    expect(ciBadge).toBeGreaterThanOrEqual(0)
    expect(codeQlBadge).toBeGreaterThan(ciBadge)
  })
})
