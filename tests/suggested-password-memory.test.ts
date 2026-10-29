import { describe, expect, it } from 'vitest'
import { createSuggestedPasswordMemory } from '../src/main/browser/suggested-password/suggested-password-memory.js'

describe('remembering the passwords Hronaut suggested', () => {
  it('knows a password only for the website it was suggested for, for an hour', () => {
    let now = 1_000_000
    const memory = createSuggestedPasswordMemory(() => now)
    memory.remember('https://accounts.example', 'k7Gm2xPqR9sTv4w')
    expect(memory.suggested('https://accounts.example', 'k7Gm2xPqR9sTv4w')).toBe(true)
    expect(memory.suggested('https://other.example', 'k7Gm2xPqR9sTv4w')).toBe(false)
    expect(memory.suggested('https://accounts.example', 'k7Gm2xPqR9sTv4W')).toBe(false)
    now += 60 * 60_000 - 1
    expect(memory.suggested('https://accounts.example', 'k7Gm2xPqR9sTv4w')).toBe(true)
    now += 1
    expect(memory.suggested('https://accounts.example', 'k7Gm2xPqR9sTv4w')).toBe(false)
  })

  it('keeps the latest 20', () => {
    const memory = createSuggestedPasswordMemory(() => 0)
    for (let index = 0; index < 21; index++) memory.remember('https://accounts.example', `password-${index}`)
    expect(memory.suggested('https://accounts.example', 'password-0')).toBe(false)
    expect(memory.suggested('https://accounts.example', 'password-1')).toBe(true)
    expect(memory.suggested('https://accounts.example', 'password-20')).toBe(true)
  })
})
