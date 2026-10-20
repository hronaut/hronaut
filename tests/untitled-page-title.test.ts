import { describe, expect, it } from 'vitest'
import { isStaleAddressTitle, untitledPageTitle } from '../src/main/browser/tab-events/untitled-page-title.js'

describe('an untitled page\'s title after it changes its address', () => {
  it('finds the old address in the forms Chromium shows it', () => {
    const dashboard = 'https://www.app.example/dashboard'
    const callback = 'https://www.app.example/oauth/callback#access_token=secret'
    expect(isStaleAddressTitle('app.example/oauth/callback#access_token=secret', callback, dashboard)).toBe(true)
    expect(isStaleAddressTitle('https://www.app.example/oauth/callback#access_token=secret', callback, dashboard)).toBe(true)
    expect(isStaleAddressTitle('\u202Aapp.example/oauth/مرحبا#access_token=secret\u202C', callback, dashboard)).toBe(true)
  })

  it('leaves the new address and titles that are no address on the site', () => {
    const callback = 'http://127.0.0.1:3000/oauth/callback'
    expect(isStaleAddressTitle('127.0.0.1:3000/dashboard#tab', callback, 'http://127.0.0.1:3000/dashboard')).toBe(false)
    expect(isStaleAddressTitle('Signing you in', callback, 'http://127.0.0.1:3000/dashboard')).toBe(false)
    expect(isStaleAddressTitle('127.0.0.1:4000/oauth/callback', callback, 'http://127.0.0.1:3000/dashboard')).toBe(false)
    expect(isStaleAddressTitle('localhost:3000/oauth/callback', 'about:blank', 'about:blank#top')).toBe(false)
  })

  it('names the new address as Chromium shows an untitled page', () => {
    expect(untitledPageTitle('http://user:pass@127.0.0.1:3000/dashboard?view=week#top')).toBe('127.0.0.1:3000/dashboard?view=week#top')
    expect(untitledPageTitle('http://app.example/')).toBe('app.example')
    expect(untitledPageTitle('https://app.example/')).toBe('https://app.example')
  })
})
