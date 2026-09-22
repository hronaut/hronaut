import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

describe('ESLint generated output boundaries', () => {
  it('ignores transient MCPB packaging files created while static gates run concurrently', async () => {
    const eslint = new ESLint()

    await expect(eslint.isPathIgnored(
      'tests/.mcpb-output/.mcpb-staging/operator-manifest.mjs'
    )).resolves.toBe(true)
  }, 15_000)
})
