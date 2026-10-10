import { describe, expect, it } from 'vitest'
import { isolatedContainer, type ContainerEngine } from '../scripts/diagnostics/protocol-capture-container.js'
const id = 'a'.repeat(64)
const image = 'sha256:' + 'b'.repeat(64)
function engine(failAt = '') {
  const calls: string[] = []
  let args: string[] = []
  const fake: ContainerEngine = {
    async create(input) { args = input; calls.push('create'); if (failAt === 'create') throw 0; return id },
    async start() { calls.push('start'); if (failAt === 'start') throw 0 },
    async wait(_id, signal) { calls.push('wait'); if (signal?.aborted || failAt === 'wait') throw 0; return 7 },
    async remove() { calls.push('remove'); if (failAt === 'remove') throw 0 },
    async absent() { calls.push('verify'); return failAt !== 'verify' }
  }
  return { fake, calls, args: () => args }
}
describe('diagnostic container PID boundary', () => {
  it('uses a private namespace and no logging/privilege expansion, preserving original exit', async () => {
    const e = engine()
    expect(await isolatedContainer('/tmp/owned', image, ['node', 'fixture.js'], undefined, e.fake)).toEqual({ exitCode: 7, killed: 0, stopped: 1 })
    expect(e.calls).toEqual(['create', 'start', 'wait', 'remove', 'verify'])
    expect(e.args()).toContain('--pull=never')
    expect(e.args()[e.args().indexOf('--user') + 1]).toBe(`${process.getuid?.()}:${process.getgid?.()}`)
    expect(e.args()).toContain('none'); expect(e.args()).toContain('--init')
    for (const forbidden of ['--privileged', '--pid', '--cap-add', '--security-opt', '/var/run/docker.sock']) expect(e.args()).not.toContain(forbidden)
    expect(e.args().filter(a => a === '--mount')).toHaveLength(2)
  })
  it('binds only the existing owned temporary directory to a short real path', async () => {
    const e = engine()
    const root = '/workspace/long-owned-parent/hronaut-protocol-capture-abcdef'
    await isolatedContainer(root, image, ['node', 'fixture.js'], undefined, e.fake)
    const mounts = e.args().flatMap((arg, index, args) => arg === '--mount' ? [args[index + 1]] : [])
    expect(mounts).toEqual([
      `type=bind,source=${root},target=${root}`,
      `type=bind,source=${root}/diagnostic-temp,target=/h-tmp`
    ])
    expect(e.args()).toContain('TMPDIR=/h-tmp')
    expect(e.args()).not.toContain(`TMPDIR=${root}/diagnostic-temp`)
    expect(e.calls).toEqual(['create', 'start', 'wait', 'remove', 'verify'])
  })
  it('cancels into container removal and verifies absence before claiming containment stopped', async () => {
    const e = engine(); const controller = new AbortController()
    e.fake.start = async () => { e.calls.push('start'); controller.abort() }
    expect(await isolatedContainer('/tmp/owned', image, ['node'], controller.signal, e.fake)).toEqual({ exitCode: null, killed: 1, stopped: 1 })
    expect(e.calls).toEqual(['create', 'start', 'wait', 'remove', 'verify'])
  })
  it('never claims stopped on create/remove/verification uncertainty', async () => {
    for (const failure of ['create', 'remove', 'verify']) {
      const e = engine(failure)
      expect((await isolatedContainer('/tmp/owned', image, ['node'], undefined, e.fake)).stopped).toBe(0)
    }
  })
  it('cleans after launch/wait failures and refuses mutable image tags before creation', async () => {
    for (const failure of ['start', 'wait']) {
      const e = engine(failure)
      expect(await isolatedContainer('/tmp/owned', image, ['node'], undefined, e.fake)).toEqual({ exitCode: null, killed: 0, stopped: 1 })
      expect(e.calls.slice(-2)).toEqual(['remove', 'verify'])
    }
    const e = engine()
    expect((await isolatedContainer('/tmp/owned', 'image:latest', ['node'], undefined, e.fake)).stopped).toBe(0)
    expect(e.calls).toEqual([])
  })
})
