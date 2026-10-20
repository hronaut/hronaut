export const MAX_CREDENTIAL_IMPORT_ROWS = 3_000

export interface ImportedCredential {
  origin: string
  username: string
  password: string
}

export interface ParsedCredentialImport {
  credentials: ImportedCredential[]
  skippedRows: number
}

export type CredentialImportErrorCode =
  | 'invalid_csv'
  | 'missing_columns'
  | 'too_many_rows'
  | 'no_credentials'

export class CredentialImportError extends Error {
  constructor(readonly code: CredentialImportErrorCode) {
    super(code)
    this.name = 'CredentialImportError'
  }
}

function parseCsvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let afterQuote = false

  const finishField = (): void => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  const finishRow = (): void => {
    finishField()
    rows.push(row)
    row = []
    if (rows.length > MAX_CREDENTIAL_IMPORT_ROWS + 1) throw new CredentialImportError('too_many_rows')
  }

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!
    if (quoted) {
      if (character !== '"') {
        field += character
        continue
      }
      if (source[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = false
        afterQuote = true
      }
      continue
    }
    if (afterQuote && character !== ',' && character !== '\r' && character !== '\n') {
      throw new CredentialImportError('invalid_csv')
    }
    if (character === '"') {
      if (field.length) throw new CredentialImportError('invalid_csv')
      quoted = true
      continue
    }
    if (character === ',') {
      finishField()
      continue
    }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index += 1
      finishRow()
      continue
    }
    field += character
  }

  if (quoted) throw new CredentialImportError('invalid_csv')
  if (field.length || row.length) finishRow()
  return rows
}

function normalizedHeader(value: string): string {
  return value.replace(/^\uFEFF/, '').trim().toLocaleLowerCase().replace(/[\s_-]+/g, '')
}

/** The first column with one of the names; the further names count only when no column has one of them. */
function columnIndex(headers: string[], candidates: readonly string[], further: readonly string[] = []): number {
  const index = headers.findIndex((header) => candidates.includes(header))
  return index < 0 ? headers.findIndex((header) => further.includes(header)) : index
}

// Bitwarden writes every address of a login into its one `login_uri` cell, separated by commas. The first ten distinct
// websites are imported, so one row cannot turn into an unbounded number of saved passwords.
const URI_LIST_SEPARATOR = /,(?=\s*[a-z][a-z\d+.-]*:)/i
const MAX_ORIGINS_PER_ROW = 10

function normalizedOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim())
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) return null
    return url.origin
  } catch {
    return null
  }
}

/** The distinct website origins a cell names: one address, or each address of a Bitwarden `login_uri` list. */
function normalizedOrigins(value: string, list: boolean): string[] {
  const origins = new Set<string>()
  for (const address of list ? value.split(URI_LIST_SEPARATOR) : [value]) {
    const origin = normalizedOrigin(address)
    if (origin) origins.add(origin)
    if (origins.size === MAX_ORIGINS_PER_ROW) break
  }
  return [...origins]
}

export function parseCredentialImportCsv(source: string): ParsedCredentialImport {
  if (source.includes('\u0000')) throw new CredentialImportError('invalid_csv')
  const rows = parseCsvRows(source)
  const header = rows.shift()
  if (!header) throw new CredentialImportError('missing_columns')
  const headers = header.map(normalizedHeader)
  // Together these are the names Chrome's import reads; `login_uri`, `login_username` and `login_password` are
  // Bitwarden's. A file with one of the first names reads the column it always did, even beside an `account` column.
  const urlIndex = columnIndex(headers, ['url', 'website', 'origin'], ['hostname', 'loginuri'])
  const usernameIndex = columnIndex(headers, ['username', 'user', 'login'], ['account', 'loginusername'])
  const passwordIndex = columnIndex(headers, ['password', 'pass'], ['loginpassword'])
  const urlList = headers[urlIndex] === 'loginuri'
  if (urlIndex < 0 || usernameIndex < 0 || passwordIndex < 0) {
    throw new CredentialImportError('missing_columns')
  }

  const credentials: ImportedCredential[] = []
  let skippedRows = 0
  for (const row of rows) {
    if (row.every((value) => value === '')) continue
    const origins = normalizedOrigins(row[urlIndex] ?? '', urlList)
    const username = row[usernameIndex] ?? ''
    const password = row[passwordIndex] ?? ''
    if (!origins.length
      || username.length > 512
      || !password
      || password.length > 16_384
      || username.includes('\u0000')
      || password.includes('\u0000')) {
      skippedRows += 1
      continue
    }
    for (const origin of origins) credentials.push({ origin, username, password })
  }
  if (!credentials.length) throw new CredentialImportError('no_credentials')
  return { credentials, skippedRows }
}
