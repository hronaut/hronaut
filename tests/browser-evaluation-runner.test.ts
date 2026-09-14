import { expect, it } from 'vitest'
import { browserEvaluationOutputPath } from '../scripts/run-browser-evaluation.js'

it('keeps browser evaluation evidence inside the repository', () => {
  expect(browserEvaluationOutputPath([], '/repo')).toEqual({
    hostPath: '/repo/test-results/browser-evaluation/report.json',
    containerPath: '/workspace/test-results/browser-evaluation/report.json'
  })
  expect(browserEvaluationOutputPath(['--output', 'test-results/custom.json'], '/repo')).toEqual({
    hostPath: '/repo/test-results/custom.json',
    containerPath: '/workspace/test-results/custom.json'
  })
  expect(() => browserEvaluationOutputPath(['--output', '../private.json'], '/repo')).toThrow(/inside the repository/)
  expect(() => browserEvaluationOutputPath(['--unknown'], '/repo')).toThrow(/Usage/)
})
