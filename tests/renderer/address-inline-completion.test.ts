import { describe, expect, it } from 'vitest'
import { inlineAddressCompletion, siteVisits } from '../../src/renderer/src/address-inline-completion.js'
import type { AddressSuggestion } from '../../src/shared/address-suggestions.js'

// The address bar left what was typed as it was, so "github" and Enter searched for it even with github.com in the
// history. Chrome fills in the rest of the site, selected, and Enter opens it.

function visit(url: string, visitCount = 2): AddressSuggestion {
  return { id: `history:${url}`, kind: 'history', title: 'Some page', url, visitCount }
}

function bookmark(url: string): AddressSuggestion {
  return { id: `bookmark:${url}`, kind: 'bookmark', title: 'Some page', url }
}

function complete(typed: string, rows: AddressSuggestion[]) {
  return inlineAddressCompletion(typed, rows, siteVisits(rows.flatMap(row => row.kind === 'history' ? [{ url: row.url, visitCount: row.visitCount ?? 1 }] : [])))
}

describe('what the address bar fills in after the typed text', () => {
  it('fills in the rest of a site\'s host, without its scheme and www., and opens the site with its own scheme', () => {
    const rows = [visit('https://www.github.com/hronaut/hronaut'), visit('http://localhost:5173/app')]
    expect(complete('git', rows)).toEqual({ text: 'github.com', url: 'https://www.github.com/', suggestionId: 'history:https://www.github.com/hronaut/hronaut' })
    expect(complete('www.git', rows)?.text).toBe('www.github.com')
    // A typed scheme, once it is whole, finds the site with or without www.
    expect(complete('https://g', rows)?.text).toBe('https://github.com')
    expect(complete('https://www.g', rows)?.text).toBe('https://www.github.com')
    // A local server keeps its port and its http.
    expect(complete('local', rows)).toMatchObject({ text: 'localhost:5173', url: 'http://localhost:5173/' })
    // The typed letters keep their case.
    expect(complete('GitH', rows)?.text).toBe('GitHub.com')
  })

  it('fills in the rest of a page once the typed text reaches its path, letter for letter', () => {
    const rows = [visit('https://github.com/Hronaut/hronaut-page'), visit('https://github.com/hronaut/hronaut')]
    expect(complete('github.com/H', rows)).toEqual({
      text: 'github.com/Hronaut/hronaut-page',
      url: 'https://github.com/Hronaut/hronaut-page',
      suggestionId: 'history:https://github.com/Hronaut/hronaut-page'
    })
    expect(complete('github.com/h', rows)?.text).toBe('github.com/hronaut/hronaut')
    expect(complete('GITHUB.com/h', rows)?.text).toBe('GITHUB.com/hronaut/hronaut')
    expect(complete('https://github.com/', rows)?.url).toBe('https://github.com/Hronaut/hronaut-page')
    // A path that differs only in its letters' case is another page, and opens as typed.
    expect(complete('localhost:5173/API', [visit('http://localhost:5173/api')])).toBeUndefined()
  })

  it('opens an address typed whole as typed, with its own scheme and port, before a longer or newer one', () => {
    const community = visit('https://github.community/')
    expect(complete('github.com', [community, visit('https://github.com/hronaut', 1)])).toEqual({
      text: 'github.com', url: 'https://github.com/', suggestionId: 'history:https://github.com/hronaut'
    })
    expect(complete('localhost:3000', [visit('http://localhost:30001/'), visit('http://localhost:3000/app', 1)])?.url).toBe('http://localhost:3000/')
    expect(complete('localhost:3000/', [visit('http://localhost:3000/dashboard'), visit('http://localhost:3000/', 1)])?.url).toBe('http://localhost:3000/')
    // Without one, the longer one fills in, shown before Enter.
    expect(complete('github.c', [community])?.text).toBe('github.community')
  })

  it('fills in only sites and pages bookmarked or visited more than once, and pages without a query or fragment', () => {
    // One visit of a site, as a redirect or an agent's tab can bring, is not enough; two visits of its pages are.
    expect(complete('git', [visit('https://github.com.attacker.example/', 1)])).toBeUndefined()
    expect(complete('git', [visit('https://github.com/a', 1), visit('https://github.com/b', 1)])?.text).toBe('github.com')
    expect(complete('git', [bookmark('https://github.com/a')])?.text).toBe('github.com')
    // A page needs two visits of its own, or a bookmark.
    expect(complete('github.com/a', [visit('https://github.com/a/b', 1), visit('https://github.com/c', 1)])).toBeUndefined()
    expect(complete('localhost:3000/a', [visit('http://localhost:3000/admin/users/7/delete?confirm=1', 5)])).toBeUndefined()
    expect(complete('localhost:3000/d', [visit('http://localhost:3000/docs#install', 5)])).toBeUndefined()
    expect(complete('localhost:3000/a', [bookmark('http://localhost:3000/admin?tab=users')])?.text).toBe('localhost:3000/admin?tab=users')
    // The first row that qualifies, in the suggestions' order.
    expect(complete('d', [visit('https://dash.example/', 1), visit('https://dev.example/'), bookmark('https://docs.example/')])?.text).toBe('dev.example')
  })

  it('leaves a search, a scope, a scheme being typed, another site\'s middle and other schemes as typed', () => {
    const rows = [
      visit('https://example.com/a'),
      visit('https://hronaut.dev/'),
      visit('file:///home/notes.html'),
      visit('data:text/html,hello'),
      visit('https://user:secret@private.example/'),
      { id: 'tab:open', kind: 'tab' as const, title: 'Open', url: 'https://open.example/', openTabId: 'open' }
    ]
    for (const typed of ['', 'git hub', 'hronaut ', '@history hr', '?hr', 'xample', 'ht', 'http', 'https:', 'https:/', 'https://', 'http://hr', 'file', 'data', 'private', 'user', 'open']) {
      expect(complete(typed, rows), typed).toBeUndefined()
    }
    // A host that starts like a scheme is still a host.
    expect(complete('h', rows)?.text).toBe('hronaut.dev')
  })
})
