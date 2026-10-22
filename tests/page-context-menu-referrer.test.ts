import { describe, expect, it } from 'vitest'
import { openedResourceReferrer, savedResourceReferrer } from '../src/main/browser/context-menus/page-context-menu-referrer.js'

const page = 'https://user:secret@shop.example/catalog/item?id=7#reviews'

describe('the referrer of a link or image saved from the page menu', () => {
  it.each([
    ['default', 'https://shop.example/images/a.png', 'https://shop.example/'],
    ['default', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['default', 'http://cdn.example/a.png', undefined],
    ['strict-origin-when-cross-origin', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['no-referrer', 'https://shop.example/a.png', undefined],
    ['unsafe-url', 'https://cdn.example/a.png', 'https://shop.example/catalog/item?id=7'],
    ['origin', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['same-origin', 'https://shop.example/a.png', 'https://shop.example/'],
    ['same-origin', 'https://cdn.example/a.png', undefined],
    ['origin-when-cross-origin', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['strict-origin', 'https://shop.example/a.png', 'https://shop.example/'],
    ['no-referrer-when-downgrade', 'https://cdn.example/a.png', 'https://shop.example/catalog/item?id=7']
  ])('under %s sends the page\'s origin or less for %s', (policy, target, referrer) => {
    // Save Link and Save Image sent no referrer, so an image host that serves only its own pages refused the save.
    expect(savedResourceReferrer(page, target, policy)).toBe(referrer)
  })

  it.each(['default', 'unsafe-url', 'origin', 'no-referrer-when-downgrade', 'strict-origin', 'same-origin'])(
    'sends nothing under %s from an HTTPS page to a plain HTTP address', (policy) => {
      // Electron's download request keeps no-referrer-when-downgrade, so Chromium cancels a save that carries one.
      expect(savedResourceReferrer(page, 'http://shop.example/a.png', policy)).toBeUndefined()
    }
  )

  it('never sends a sign-in or a fragment from the page address', () => {
    expect(savedResourceReferrer(page, 'https://shop.example/a.png', 'unsafe-url')).not.toMatch(/secret|user@|#/)
  })

  it('counts only HTTPS as secure, as Chromium does for the page\'s own requests', () => {
    expect(savedResourceReferrer('https://shop.example/p', 'http://127.0.0.1:8080/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('http://localhost:3000/p', 'http://cdn.example/a.png', 'default')).toBe('http://localhost:3000/')
    expect(savedResourceReferrer('http://localhost:3000/p', 'http://localhost:3000/a.png', 'unsafe-url')).toBe('http://localhost:3000/p')
  })

  it('sends only the origin for an address too long to be a referrer', () => {
    const fits = `https://shop.example/search?q=${'a'.repeat(4096 - 'https://shop.example/search?q='.length)}`
    expect(savedResourceReferrer(fits, 'https://shop.example/a.png', 'unsafe-url')).toBe(fits)
    expect(savedResourceReferrer(`${fits}a`, 'https://shop.example/a.png', 'unsafe-url')).toBe('https://shop.example/')
  })

  it('sends nothing from a page that is not a website, or for a target that is not one', () => {
    expect(savedResourceReferrer('about:srcdoc', 'https://shop.example/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('data:text/html,x', 'https://shop.example/a.png', 'unsafe-url')).toBeUndefined()
    expect(savedResourceReferrer('', 'https://shop.example/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('https://shop.example/p', 'ftp://files.example/a.png', 'unsafe-url')).toBeUndefined()
  })
})

describe('the referrer of a link or image opened in a new tab from the page menu', () => {
  it.each(['default', 'unsafe-url', 'no-referrer-when-downgrade', 'origin', 'strict-origin-when-cross-origin', 'same-origin', 'strict-origin'])(
    'passes the page\'s address under %s for Chromium to apply', (policy) => {
      expect(openedResourceReferrer(page, policy)).toEqual({ url: 'https://shop.example/catalog/item?id=7', policy })
    }
  )

  it('sends nothing under no-referrer, under a policy Electron cannot pass on, or from a page not on the web', () => {
    expect(openedResourceReferrer(page, 'no-referrer')).toBeUndefined()
    expect(openedResourceReferrer(page, 'origin-when-cross-origin')).toBeUndefined()
    expect(openedResourceReferrer('file:///home/user/page.html', 'unsafe-url')).toBeUndefined()
    expect(openedResourceReferrer('', 'default')).toBeUndefined()
  })
})
