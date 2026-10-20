import { describe, expect, it } from 'vitest'
import { savedResourceReferrer } from '../src/main/browser/context-menus/page-context-menu-referrer.js'

const page = 'https://user:secret@shop.example/catalog/item?id=7#reviews'

describe('the referrer of a link or image saved from the page menu', () => {
  it.each([
    ['default', 'https://shop.example/images/a.png', 'https://shop.example/catalog/item?id=7'],
    ['default', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['default', 'http://cdn.example/a.png', undefined],
    ['strict-origin-when-cross-origin', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['no-referrer', 'https://shop.example/a.png', undefined],
    ['unsafe-url', 'http://cdn.example/a.png', 'https://shop.example/catalog/item?id=7'],
    ['origin', 'https://shop.example/a.png', 'https://shop.example/'],
    ['same-origin', 'https://shop.example/a.png', 'https://shop.example/catalog/item?id=7'],
    ['same-origin', 'https://cdn.example/a.png', undefined],
    ['origin-when-cross-origin', 'https://cdn.example/a.png', 'https://shop.example/'],
    ['strict-origin', 'https://shop.example/a.png', 'https://shop.example/'],
    ['strict-origin', 'http://shop.example/a.png', undefined],
    ['no-referrer-when-downgrade', 'https://cdn.example/a.png', 'https://shop.example/catalog/item?id=7'],
    ['no-referrer-when-downgrade', 'http://cdn.example/a.png', undefined]
  ])('under %s sends what the page itself would for %s', (policy, target, referrer) => {
    // Save Link and Save Image sent no referrer, so an image host that serves only its own pages refused the save.
    expect(savedResourceReferrer(page, target, policy)).toBe(referrer)
  })

  it('never sends a sign-in or a fragment from the page address', () => {
    expect(savedResourceReferrer(page, 'https://shop.example/a.png', 'unsafe-url')).not.toMatch(/secret|user@|#/)
  })

  it('counts only HTTPS as secure, as Chromium does for the page\'s own requests', () => {
    expect(savedResourceReferrer('https://shop.example/p', 'http://127.0.0.1:8080/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('http://localhost:3000/p', 'http://cdn.example/a.png', 'default')).toBe('http://localhost:3000/')
    expect(savedResourceReferrer('http://localhost:3000/p', 'http://localhost:3000/a.png', 'default')).toBe('http://localhost:3000/p')
  })

  it('sends only the origin for an address too long to be a referrer', () => {
    const long = `https://shop.example/search?q=${'a'.repeat(5000)}`
    expect(savedResourceReferrer(long, 'https://shop.example/a.png', 'unsafe-url')).toBe('https://shop.example/')
  })

  it('sends nothing from a page that is not a website, or for a target that is not one', () => {
    expect(savedResourceReferrer('about:srcdoc', 'https://shop.example/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('data:text/html,x', 'https://shop.example/a.png', 'unsafe-url')).toBeUndefined()
    expect(savedResourceReferrer('', 'https://shop.example/a.png', 'default')).toBeUndefined()
    expect(savedResourceReferrer('https://shop.example/p', 'ftp://files.example/a.png', 'unsafe-url')).toBeUndefined()
  })
})
