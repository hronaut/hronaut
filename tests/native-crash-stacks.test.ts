import { describe, expect, it } from 'vitest'
import { nativeCrashStackReader, type NativeCrashStack } from './integration/native-crash-stacks.js'

// A renderer that crashed in an e2e run left only "crashed, exit code 139", which says nothing about where.

const trace = [
  'Received signal 11 SEGV_MAPERR 000000000000',
  '#0 0x56364c2c35a3 (/workspace/node_modules/electron/dist/electron+0x949c5a2)',
  '#1 0x7ff17b845330 (/usr/lib/x86_64-linux-gnu/libc.so.6+0x4532f)',
  '#2 0x5636479ae3ee (/workspace/node_modules/electron/dist/electron+0x4b873ed)',
  '[end of stack trace]'
]

function read(chunks: string[]): NativeCrashStack[] {
  const stacks: NativeCrashStack[] = []
  const reader = nativeCrashStackReader(stack => stacks.push(stack))
  for (const chunk of chunks) reader(chunk)
  return stacks
}

describe('native crash stacks in a launch\'s error output', () => {
  it('keeps the signal and each frame as its module\'s file name and offset, from chunks split anywhere', () => {
    const text = ['[1026/005221.866410:ERROR:gpu_init.cc] unrelated', ...trace, 'after the trace', ''].join('\n')
    const expected = [{
      signal: '11 SEGV_MAPERR 000000000000',
      frames: ['electron+0x949c5a2', 'libc.so.6+0x4532f', 'electron+0x4b873ed']
    }]
    expect(read([text])).toEqual(expected)
    expect(read(text.match(/[\s\S]{1,7}/g)!)).toEqual(expected)
    expect(read([text.replaceAll('\n', '\r\n')])).toEqual(expected)
  })

  it('keeps a trace whose process ended while printing it, and ends one at output that is not a frame', () => {
    const stacks = read([`${trace.slice(0, 2).join('\n')}\nsomething else\n#7 0xabc (/opt/electron+0x10)\n${trace.slice(0, 3).join('\n')}\n`])
    expect(stacks).toEqual([
      { signal: '11 SEGV_MAPERR 000000000000', frames: ['electron+0x949c5a2'] },
      { signal: '11 SEGV_MAPERR 000000000000', frames: ['electron+0x949c5a2', 'libc.so.6+0x4532f'] }
    ])
  })

  it('stays bounded: 64 frames a trace, a signal line of 80 characters, no endless line', () => {
    const frames = Array.from({ length: 100 }, (_, index) => `#${index} 0x1 (/opt/electron+0x${index.toString(16)})`)
    const stacks = read([`Received signal 11 ${'x'.repeat(200)}\n${frames.join('\n')}\n`, 'y'.repeat(10_000), '\nReceived signal 7 BUS_ADRERR 1\n'])
    expect(stacks).toHaveLength(2)
    expect(stacks[0]?.signal).toHaveLength(80)
    expect(stacks[0]?.frames).toHaveLength(64)
    expect(stacks[1]).toEqual({ signal: '7 BUS_ADRERR 1', frames: [] })
  })

  it('leaves out frames that name no module, and never a folder', () => {
    const stacks = read(['Received signal 6\n#0 0x7f00 <unknown>\n#1 0x5600 (/home/person/app/electron+0x20)\n'])
    expect(stacks).toEqual([{ signal: '6', frames: ['electron+0x20'] }])
    expect(JSON.stringify(stacks)).not.toContain('/')
  })
})
