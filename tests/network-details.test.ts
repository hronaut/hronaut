import { describe, expect, it, vi } from 'vitest'
import { redactNetworkHeaders, redactNetworkUrl, sanitizeNetworkBody } from '../src/shared/network-details.js'

describe('network detail redaction', () => {
  it('redacts credentials and sensitive query values without hiding useful URL data', () => {
    expect(redactNetworkUrl('https://person:password@example.test/api?token=secret&view=compact#private')).toBe(
      'https://%5BREDACTED%5D:%5BREDACTED%5D@example.test/api?view=compact&token=%5BREDACTED%5D'
    )
  })

  it.each([
    ['Azure SAS', 'https://store.blob.core.windows.net/files/report.pdf?sv=2024-11-04&se=2026-10-21&sr=b&sp=r&sig=SECRET', ['sv', 'se', 'sr', 'sp']],
    ['CloudFront', 'https://d1.cloudfront.net/report.pdf?Expires=1790000000&Signature=SECRET&Key-Pair-Id=K2', ['Expires', 'Key-Pair-Id']],
    ['S3 SigV2', 'https://bucket.s3.amazonaws.com/report.pdf?AWSAccessKeyId=AKIA&Expires=1790000000&Signature=SECRET', ['AWSAccessKeyId', 'Expires']],
    ['S3 SigV4', 'https://bucket.s3.amazonaws.com/report.pdf?X-Amz-Date=20261020T000000Z&X-Amz-Signature=SECRET', ['X-Amz-Date']],
    ['Google Cloud Storage', 'https://storage.googleapis.com/b/report.pdf?X-Goog-Date=20261020T000000Z&X-Goog-Signature=SECRET', ['X-Goog-Date']],
    ['release asset', 'https://release-assets.example/asset?sp=r&sig=SECRET&jwt=SECRET', ['sp']],
    ['Tencent COS', 'https://bucket.cos.ap-beijing.myqcloud.com/report.pdf?q-sign-algorithm=sha1&q-ak=AK&q-signature=SECRET', ['q-sign-algorithm', 'q-ak']],
    ['Akamai token', 'https://video.example/master.m3u8?hdnts=SECRET', []],
    ['Alibaba OSS', 'https://bucket.oss-cn-hangzhou.aliyuncs.com/report.pdf?x-oss-signature-version=OSS4-HMAC-SHA256&x-oss-signature=SECRET', ['x-oss-signature-version']],
    ['SharePoint', 'https://contoso.sharepoint.com/sites/team/_layouts/15/download.aspx?UniqueId=1d2c&Translate=false&tempauth=SECRET&ApiVersion=2.0', ['UniqueId', 'Translate', 'ApiVersion']],
    ['Discord attachment', 'https://cdn.discordapp.com/attachments/1/2/report.pdf?ex=6720f3a1&is=671fa221&hm=SECRET&', ['ex', 'is']],
    ['Shopify', 'https://shop.example/apps/files/report.pdf?shop=demo.myshopify.com&timestamp=1790000000&hmac=SECRET', ['shop', 'timestamp']],
    ['nginx secure', 'https://media.example/videos/demo.mp4?md5=SECRET&expires=1790000000', ['expires']]
  ])('redacts the signature of a signed %s link', (_label, url, kept) => {
    // The signature stayed in download records and network results, so the link kept working for whoever read them.
    const redacted = redactNetworkUrl(url)
    expect(redacted).not.toContain('SECRET')
    const parameters = new URL(redacted).searchParams
    for (const name of kept) expect(parameters.get(name)).toBe(new URL(url).searchParams.get(name))
  })

  it('redacts the signature of a signed link a redirect or referrer header names', () => {
    // A redirect to a signed release asset kept the signature in its Location header, so request details, HAR exports
    // and cURL copies held a working link.
    expect(redactNetworkHeaders({
      Location: 'https://release-assets.example/asset?sp=r&sig=SECRET&jwt=SECRET',
      'content-location': '/files/report.pdf?Expires=1790000000&Signature=SECRET#part',
      Referer: ['https://store.blob.core.windows.net/page?sv=1&sig=SECRET'],
      'X-Request-Id': 'sig=kept'
    })).toEqual({
      Location: 'https://release-assets.example/asset?sp=r&sig=%5BREDACTED%5D&jwt=%5BREDACTED%5D',
      'content-location': '/files/report.pdf?Expires=1790000000&Signature=%5BREDACTED%5D',
      Referer: ['https://store.blob.core.windows.net/page?sv=1&sig=%5BREDACTED%5D'],
      'X-Request-Id': 'sig=kept'
    })
    expect(redactNetworkHeaders({ Location: '/next?step=2#top' })).toEqual({ Location: '/next?step=2#top' })
  })

  it('redacts signature fields of a form-encoded body', () => {
    const body = sanitizeNetworkBody('SAMLResponse=abc&jwt=SECRET&signature=SECRET&design=dark', 'application/x-www-form-urlencoded', 1_000)
    expect(body.text).not.toContain('SECRET')
    expect(body.text).toContain('design=dark')
    expect(body.redacted).toBe(true)
  })

  it.each([
    ['a Google API key', 'https://maps.example/api/js?key=AIzaSECRET&libraries=places', ['libraries']],
    ['an access key', 'https://tiles.example/v1/map.png?access_key=SECRET&accessKey=SECRET&access-key=SECRET&zoom=4', ['zoom']],
    ['an API Management subscription key', 'https://api.example/orders?subscription-key=SECRET&page=2', ['page']],
    ['a sign-in', 'https://feed.example/export.ics?auth=SECRET&format=ics', ['format']],
    ['a session id', 'https://shop.example/cart?sid=SECRET&PHPSESSID=SECRET&step=2', ['step']],
    ['a password', 'https://router.example/login.cgi?user=admin&pwd=SECRET', ['user']]
  ])('redacts %s in a link', (_label, url, kept) => {
    // The value stayed in download records, network results and snapshots, so whoever read them could reuse it.
    const redacted = redactNetworkUrl(url)
    expect(redacted).not.toContain('SECRET')
    const parameters = new URL(redacted).searchParams
    for (const name of kept) expect(parameters.get(name)).toBe(new URL(url).searchParams.get(name))
  })

  it('redacts a session id that a Java server keeps in the path', () => {
    expect(redactNetworkUrl('https://shop.example/cart;jsessionid=SECRET?step=2')).toBe('https://shop.example/cart;jsessionid=[REDACTED]?step=2')
    expect(redactNetworkUrl('https://shop.example/a;JSESSIONID=SECRET/b;jsessionid=SECRET')).toBe('https://shop.example/a;JSESSIONID=[REDACTED]/b;jsessionid=[REDACTED]')
  })

  it('redacts a session id in the path of a relative redirect', () => {
    // Tomcat redirects relatively by default and puts the session in the first redirect's path, so the header kept it.
    expect(redactNetworkHeaders({ location: '/app/home;jsessionid=SECRET' })).toEqual({ location: '/app/home;jsessionid=[REDACTED]' })
    expect(redactNetworkHeaders({ location: '/x;jsessionid=SECRET?sid=SECRET&step=2#top' })).toEqual({ location: '/x;jsessionid=[REDACTED]?step=2&sid=%5BREDACTED%5D' })
    expect(redactNetworkHeaders({ 'content-location': '//cdn.example/a;jsessionid=SECRET' })).toEqual({ 'content-location': '//cdn.example/a;jsessionid=[REDACTED]' })
    expect(redactNetworkHeaders({ location: '/plain/path?step=2#top' })).toEqual({ location: '/plain/path?step=2#top' })
  })

  it('redacts the password of a WordPress sign-in form and a JSON body', () => {
    // WordPress posts `log` and `pwd`, so the password stayed in the request's details.
    const form = sanitizeNetworkBody('log=admin&pwd=SECRET&rememberme=forever', 'application/x-www-form-urlencoded', 1_000)
    expect(form.text).not.toContain('SECRET')
    expect(form.text).toContain('log=admin')
    const json = sanitizeNetworkBody('{"user":"admin","pwd":"SECRET","passphrase":"SECRET"}', 'application/json', 1_000)
    expect(json.text).not.toContain('SECRET')
    expect(json.text).toContain('admin')
  })

  it('redacts the password of Drupal, WordPress, Roundcube and Simple Machines Forum forms, and a pw field', () => {
    // Drupal posts its password as `pass`, WordPress a new one as `pass1` and `pass2`, Roundcube as `_pass` and Simple
    // Machines Forum as `passwrd`, which no pattern matched, so it stayed readable in the panel, its copies and agents'
    // browser_network_request.
    const signIn = sanitizeNetworkBody('name=admin&pass=SECRET&form_id=user_login_form&op=Log+in', 'application/x-www-form-urlencoded', 1_000)
    expect(signIn.text).toBe('name=admin&form_id=user_login_form&op=Log+in&pass=%5BREDACTED%5D')
    expect(signIn.redacted).toBe(true)
    const form = (body: string) => new URLSearchParams(sanitizeNetworkBody(body, 'application/x-www-form-urlencoded', 1_000).text)
    const drupalChange = form('current_pass=OLDSECRET&pass%5Bpass1%5D=SECRET&pass%5Bpass2%5D=SECRET&user%5Bpass%5D=SECRET&mail=a%40b.example')
    for (const name of ['current_pass', 'pass[pass1]', 'pass[pass2]', 'user[pass]']) expect(drupalChange.get(name)).toBe('[REDACTED]')
    expect(drupalChange.get('mail')).toBe('a@b.example')
    const wordPressReset = form('pass1=SECRET&pass2=SECRET&pw_weak=on&wp-submit=Save+Password')
    expect([wordPressReset.get('pass1'), wordPressReset.get('pass2')]).toEqual(['[REDACTED]', '[REDACTED]'])
    expect(wordPressReset.get('pw_weak')).toBe('on')
    expect(form('_user=ada&_pass=SECRET').get('_pass')).toBe('[REDACTED]')
    expect(form('user=ada&passwrd=SECRET').get('passwrd')).toBe('[REDACTED]')
    expect(sanitizeNetworkBody('{"name":"admin","pass":"SECRET"}', 'application/json', 1_000).text).not.toContain('SECRET')
    expect(JSON.parse(sanitizeNetworkBody('{"pass":[{"existing":"OLDSECRET","value":"SECRET"}],"pin":{"pw":1234}}', 'application/json', 1_000).text))
      .toEqual({ pass: '[REDACTED]', pin: { pw: '[REDACTED]' } })
    expect(redactNetworkUrl('https://forum.example/login.php?id=ada&pw=SECRET')).not.toContain('SECRET')
    // Names that only contain pass or pw stay readable, and so does a JSON true, false or null under pass or pw, as in a
    // test report.
    const kept = 'passenger=2&compass=north&bypass=1&pwa=installed&passes=3&pass_rate=0.9&pass_through=1&pw_weak=on'
    expect(sanitizeNetworkBody(kept, 'application/x-www-form-urlencoded', 1_000)).toEqual({ text: kept, originalChars: kept.length, truncated: false, redacted: false })
    const report = '{"checks":[{"name":"build","pass":true},{"name":"lint","pass":false}],"pw":null}'
    const sanitizedReport = sanitizeNetworkBody(report, 'application/json', 1_000)
    expect(JSON.parse(sanitizedReport.text)).toEqual(JSON.parse(report))
    expect(sanitizedReport.redacted).toBe(false)
  })

  it('keeps ordinary query parameters whose names contain key, auth or sid', () => {
    expect(redactNetworkUrl('https://example.test/?keyword=shoes&monkey=1&author=me&side=left&inside=1'))
      .toBe('https://example.test/?keyword=shoes&monkey=1&author=me&side=left&inside=1')
  })

  it('keeps ordinary query parameters whose names contain sig', () => {
    expect(redactNetworkUrl('https://example.test/?design=dark&signal=on&signup=1&assign=me'))
      .toBe('https://example.test/?design=dark&signal=on&signup=1&assign=me')
  })

  it('redacts security headers while preserving diagnostic headers', () => {
    expect(redactNetworkHeaders({
      Authorization: 'Bearer secret',
      Cookie: ['session=private'],
      'X-Api-Key': 'private',
      'Content-Type': 'application/json',
      'X-Request-Id': 'request-42'
    })).toEqual({
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      'X-Api-Key': '[REDACTED]',
      'Content-Type': 'application/json',
      'X-Request-Id': 'request-42'
    })
  })

  it('preserves prototype-named JSON fields while redacting their nested secrets', () => {
    const body = '{"__proto__":{"visible":"kept","password":"fixture-secret"},"constructor":{"token":"fixture-token"},"nested":[{"__proto__":"literal"}]}'
    const result = sanitizeNetworkBody(body, 'application/json', 10_000)
    const parsed = JSON.parse(result.text)

    expect(Object.hasOwn(parsed, '__proto__')).toBe(true)
    expect(parsed).toEqual(JSON.parse(
      '{"__proto__":{"visible":"kept","password":"[REDACTED]"},"constructor":{"token":"[REDACTED]"},"nested":[{"__proto__":"literal"}]}'
    ))
    expect(result.redacted).toBe(true)
    expect(result.text).not.toContain('fixture-')
  })

  it.each([{ value: 'literal' }, { value: ['first', 'second'] }])('preserves prototype-named headers as own data properties (%j)', ({ value }) => {
    const headers = redactNetworkHeaders({ ['__proto__']: value, Authorization: 'fixture-secret' })

    expect(Object.hasOwn(headers, '__proto__')).toBe(true)
    expect(headers.__proto__).toEqual(value)
    expect(Object.getPrototypeOf(headers)).toBeNull()
    expect(JSON.parse(JSON.stringify(headers))).toEqual({ ['__proto__']: value, Authorization: '[REDACTED]' })
  })

  it('redacts nested JSON secrets and bounds the formatted output', () => {
    const result = sanitizeNetworkBody(JSON.stringify({
      ok: true,
      access_token: 'private',
      nested: { password: 'private', visible: 'kept' }
    }), 'application/json', 10_000)

    expect(JSON.parse(result.text)).toEqual({
      ok: true,
      access_token: '[REDACTED]',
      nested: { password: '[REDACTED]', visible: 'kept' }
    })
    expect(result).toMatchObject({ truncated: false, redacted: true })
  })

  it.each(['text/plain', 'application/json', undefined])('omits deeply nested JSON instead of exposing secrets (%s)', (contentType) => {
    for (const [open, close] of [['[', ']'], ['{"child":', '}']]) {
      const body = '{"password":"fixture-secret","nested":'
        + open!.repeat(12_000) + '0' + close!.repeat(12_000) + '}'
      const result = sanitizeNetworkBody(body, contentType, 1_000)

      expect(result.text).toBe('[JSON body omitted: could not safely redact]')
      expect(result.text).not.toContain('fixture-secret')
      expect(result).toMatchObject({ originalChars: body.length, redacted: true, truncated: false })
    }
  })

  it('retains incomplete plain-text JSON as bounded text', () => {
    expect(sanitizeNetworkBody('{"status":', 'text/plain', 1_000).text).toBe('{"status":')
  })

  it('redacts form fields and omits binary or multipart bodies', () => {
    expect(sanitizeNetworkBody('name=Ada&password=private', 'application/x-www-form-urlencoded', 1_000).text)
      .toBe('name=Ada&password=%5BREDACTED%5D')
    expect(sanitizeNetworkBody('base64-data', 'image/png', 1_000, { base64Encoded: true }).text)
      .toBe('[binary body omitted]')
    expect(sanitizeNetworkBody('multipart-data', 'multipart/form-data; boundary=test', 1_000).text)
      .toBe('[multipart body omitted]')
  })

  it.each(['url', 'form'])('redacts repeated %s parameters without quadratic rewrites', (kind) => {
    const input = Array(200).fill('token=fixture-secret').join('&') + '&view=full&password=p&token=last'
    const append = vi.spyOn(URLSearchParams.prototype, 'append')
    try {
      const text = kind === 'url'
        ? new URL(redactNetworkUrl(`https://example.test/?${input}`)).search.slice(1)
        : sanitizeNetworkBody(input, 'application/x-www-form-urlencoded', 100_000).text
      const result = new URLSearchParams(text)
      expect(result.get('view')).toBe('full')
      expect(result.get('password')).toBe('[REDACTED]')
      expect(result.getAll('token')).toEqual(Array(201).fill('[REDACTED]'))
      expect([...result.keys()].slice(0, 3)).toEqual(['view', 'password', 'token'])
      expect(text).not.toContain('fixture-secret')
      // Count work instead of relying on machine-dependent elapsed-time limits.
      expect(append.mock.calls.length).toBeLessThanOrEqual(203)
    } finally {
      append.mockRestore()
    }
  })

  it('marks long text responses as truncated', () => {
    const result = sanitizeNetworkBody('abcdefghijkl', 'text/plain', 5)
    expect(result.text).toBe('abcde\n[truncated after 5 characters]')
    expect(result).toMatchObject({ originalChars: 12, truncated: true, redacted: false })
  })
})
