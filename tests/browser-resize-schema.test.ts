import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { registerBrowserResize } from '../src/main/mcp/tools/browser-resize/index.js'

function resizeInput(): z.ZodObject<z.ZodRawShape> {
  let shape: z.ZodRawShape | undefined
  registerBrowserResize({
    manager: {},
    tabTool: (_name: string, callback: unknown) => callback,
    registerWorkspaceTool: (_name: string, config: { inputSchema: z.ZodRawShape }) => { shape = config.inputSchema }
  } as never)
  return z.object(shape!)
}

describe('browser_resize input', () => {
  it('offers the sizes viewport emulation applies, up to 3840 CSS pixels each way', () => {
    expect(resizeInput().safeParse({ width: 3840, height: 3840 }).success).toBe(true)
    expect(resizeInput().safeParse({ width: 320, height: 240 }).success).toBe(true)
  })

  it.each([{ width: 3841, height: 2160 }, { width: 7680, height: 4320 }, { width: 1920, height: 3841 }])('rejects %j before reaching emulation, which refuses it', input => {
    expect(resizeInput().safeParse(input).success).toBe(false)
  })
})
