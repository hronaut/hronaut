import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CredentialImportError,
  MAX_CREDENTIAL_IMPORT_ROWS,
  parseCredentialImportCsv
} from '../src/main/credentials/credential-import.js'

describe('browser password CSV import', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('parses Chrome-style exports, quoted values, and a UTF-8 BOM', () => {
    const parsed = parseCredentialImportCsv([
      '\uFEFFname,url,username,password,note',
      'Example,https://example.test/login,person@example.test,"comma,password","line one',
      'line two"',
      'Quoted,https://quoted.test/path,"person ""Q""","secret""value",'
    ].join('\r\n'))

    expect(parsed).toEqual({
      skippedRows: 0,
      credentials: [
        {
          origin: 'https://example.test',
          username: 'person@example.test',
          password: 'comma,password'
        },
        {
          origin: 'https://quoted.test',
          username: 'person "Q"',
          password: 'secret"value'
        }
      ]
    })
  })

  it('accepts Firefox extra columns and skips unsafe or incomplete rows', () => {
    const parsed = parseCredentialImportCsv([
      'url,username,password,httpRealm,formActionOrigin,guid',
      'https://mozilla.test/login,firefox-user,firefox-secret,,,guid-1',
      'javascript:alert(1),attacker,secret,,,guid-2',
      'file:///tmp/login,local,secret,,,guid-3',
      'https://empty.test,user,,,,guid-4',
      ',missing,secret,,,guid-5',
      ',,,,,',
    ].join('\n'))

    expect(parsed.credentials).toEqual([{
      origin: 'https://mozilla.test',
      username: 'firefox-user',
      password: 'firefox-secret'
    }])
    expect(parsed.skippedRows).toBe(4)
  })

  it('accepts common website and login header aliases without treating a site name as a username', () => {
    expect(parseCredentialImportCsv('website,login,pass\nhttps://example.test/path,person,secret').credentials)
      .toEqual([{ origin: 'https://example.test', username: 'person', password: 'secret' }])
    expect(() => parseCredentialImportCsv('name,url,password\nPerson,https://example.test,secret'))
      .toThrowError(expect.objectContaining({ code: 'missing_columns' }))
  })

  it('imports a Bitwarden export, saving a login for each website it lists', () => {
    // Bitwarden names its columns login_uri, login_username and login_password, so its export failed with
    // missing_columns, and a login with two addresses would have been saved for neither site.
    const parsed = parseCredentialImportCsv([
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp',
      ',,login,Example,,,0,"https://example.test/login,https://www.example.test/,androidapp://com.example",person,secret,',
      'Work,1,login,Same site,,,0,"https://same.test/a, https://same.test/b",worker,other,',
      ',,note,Secure note,text,,0,,,,',
      ',,login,Search,,,0,"https://search.test/find?q=a,b",searcher,third,'
    ].join('\n'))

    expect(parsed.credentials).toEqual([
      { origin: 'https://example.test', username: 'person', password: 'secret' },
      { origin: 'https://www.example.test', username: 'person', password: 'secret' },
      { origin: 'https://same.test', username: 'worker', password: 'other' },
      { origin: 'https://search.test', username: 'searcher', password: 'third' }
    ])
    expect(parsed.skippedRows).toBe(1)
  })

  it('leaves addresses without a scheme out of a Bitwarden list and keeps the rest', () => {
    // A list was split only before an address with a scheme, so `example.com` stayed inside the first address and made
    // an origin no page has, and an IP address made the whole row unreadable.
    const parsed = parseCredentialImportCsv('login_uri,login_username,login_password\n"https://a.test,example.com,192.168.1.1,https://b.test",person,secret')
    expect(parsed.credentials.map(entry => entry.origin)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('ends a Bitwarden list at an address with a query, whose commas may be its own', () => {
    // A sign-in page's address whose query names another site must not save the password for that site too.
    const parsed = parseCredentialImportCsv([
      'login_uri,login_username,login_password',
      '"https://bank.test/login?next=,https://evil.test/",person,secret',
      '"https://shop.test/#a,https://other.test",buyer,secret'
    ].join('\n'))
    expect(parsed.credentials.map(entry => entry.origin)).toEqual(['https://bank.test', 'https://shop.test'])
  })

  it('saves a login for at most ten websites from one Bitwarden row', () => {
    const addresses = ['https://site0.test/a', ...Array.from({ length: 12 }, (_, index) => `https://site${index}.test`)].join(',')
    const parsed = parseCredentialImportCsv(`login_uri,login_username,login_password\n"${addresses}",person,secret`)
    expect(parsed.credentials.map(entry => entry.origin)).toEqual(
      Array.from({ length: 10 }, (_, index) => `https://site${index}.test`)
    )
  })

  it('reads one address per cell in other exports, even when it contains a comma and another address', () => {
    const parsed = parseCredentialImportCsv('url,username,password\n"https://a.test/login?next=x,https://b.test",person,secret')
    expect(parsed.credentials).toEqual([{ origin: 'https://a.test', username: 'person', password: 'secret' }])
  })

  it('reads the user name column of a KeePass CSV export, not the entry title in Account', () => {
    const parsed = parseCredentialImportCsv([
      '"Account","Login Name","Password","Web Site","Comments"',
      '"My Bank","person","secret","https://bank.test/",""'
    ].join('\r\n'))
    expect(parsed.credentials).toEqual([{ origin: 'https://bank.test', username: 'person', password: 'secret' }])
  })

  // KeePass's CSV (1.x) export writes a quote as \" and a backslash as \\: a Windows domain user name was saved with
  // both backslashes, and a quote anywhere in the file refused the whole file as not CSV.
  it('reads the backslash escapes of a KeePass CSV export', () => {
    const parsed = parseCredentialImportCsv([
      '"Account","Login Name","Password","Web Site","Comments"',
      '"Corp VPN","CORP\\\\jdoe","ends with \\\\","https://vpn.corp.test/","Line one',
      'line two"',
      '"Mail","me","pa\\"ss","https://mail.test/","say \\"hi\\""'
    ].join('\r\n'))
    expect(parsed.credentials).toEqual([
      { origin: 'https://vpn.corp.test', username: 'CORP\\jdoe', password: 'ends with \\' },
      { origin: 'https://mail.test', username: 'me', password: 'pa"ss' }
    ])
  })

  it('keeps backslashes as written in other exports', () => {
    expect(parseCredentialImportCsv('url,username,password\nhttps://a.test,CORP\\jdoe,"p\\"').credentials)
      .toEqual([{ origin: 'https://a.test', username: 'CORP\\jdoe', password: 'p\\' }])
  })

  it('prefers the more specific of the further header names, wherever their columns are', () => {
    expect(parseCredentialImportCsv('hostname,account,login_uri,login_username,login_password\nhttps://other.test,Title,"https://a.test,https://b.test",person,secret')
      .credentials).toEqual([
      { origin: 'https://a.test', username: 'person', password: 'secret' },
      { origin: 'https://b.test', username: 'person', password: 'secret' }
    ])
    expect(parseCredentialImportCsv('login_username,username,url,password\nother,person,https://a.test,secret').credentials)
      .toEqual([{ origin: 'https://a.test', username: 'person', password: 'secret' }])
  })

  it('matches header names in any letter case, with a byte order mark, under Turkish case rules too', () => {
    // The locale's lower case turns `LOGIN_URI` into `logın_urı` under Turkish rules, so the column was not found.
    vi.spyOn(String.prototype, 'toLocaleLowerCase').mockImplementation(function (this: string) {
      return this.replace(/I/g, '\u0131').toLowerCase()
    })
    expect(parseCredentialImportCsv('\uFEFFName,LOGIN URI,LOGIN_USERNAME,Login Password\nX,"https://a.test,https://b.test",person,secret')
      .credentials.map(entry => entry.origin)).toEqual(['https://a.test', 'https://b.test'])
  })

  it('accepts the hostname and account header names Chrome reads', () => {
    expect(parseCredentialImportCsv('hostname,account,password\nhttps://example.test,person,secret').credentials)
      .toEqual([{ origin: 'https://example.test', username: 'person', password: 'secret' }])
    // A file that imported before still reads the same columns when it also has one of the further names.
    expect(parseCredentialImportCsv('account,hostname,url,username,password\nWork,https://other.test,https://example.test,person,secret')
      .credentials).toEqual([{ origin: 'https://example.test', username: 'person', password: 'secret' }])
  })

  it('rejects malformed, binary, empty, and oversized exports without echoing their contents', () => {
    const cases: Array<[string, CredentialImportError['code']]> = [
      ['url,username,password\nhttps://example.test,user,"private-secret', 'invalid_csv'],
      ['url,username,password\nhttps://example.test,user,sec\u0000ret', 'invalid_csv'],
      ['site,account,secret\nhttps://example.test,user,password', 'missing_columns'],
      ['url,username,password\nhttps://example.test,user,', 'no_credentials'],
      [
        ['url,username,password', ...Array.from(
          { length: MAX_CREDENTIAL_IMPORT_ROWS + 1 },
          (_, index) => `https://example${index}.test,user,secret`
        )].join('\n'),
        'too_many_rows'
      ]
    ]

    for (const [source, code] of cases) {
      try {
        parseCredentialImportCsv(source)
        throw new Error('Expected parsing to fail')
      } catch (error) {
        expect(error).toBeInstanceOf(CredentialImportError)
        expect((error as CredentialImportError).code).toBe(code)
        expect((error as Error).message).not.toContain('private-secret')
      }
    }
  })
})
