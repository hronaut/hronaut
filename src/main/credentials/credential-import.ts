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

// KeePass's CSV (1.x) export, which has exactly this header, writes a quote in a field as \" and a backslash as \\,
// where other exports double a quote.
const KEEPASS_1X_HEADER = /^\uFEFF?"Account","Login Name","Password","Web Site","Comments"(?:\r|\n|$)/

function parseCsvRows(source: string, backslashEscapes: boolean): string[][] {
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
      if (backslashEscapes && character === '\\' && (source[index + 1] === '"' || source[index + 1] === '\\')) {
        field += source[index + 1]
        index += 1
        continue
      }
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
  // Not the locale's lower case: under Turkish rules `LOGIN_URI` would become `logın_urı`.
  return value.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_-]+/g, '')
}

/**
 * The first column with one of the names. The further names count only when no column has one of them, in the order
 * they are listed, so a file that imported before reads the same column and a more specific name wins over `account`.
 */
function columnIndex(headers: string[], candidates: readonly string[], further: readonly string[]): number {
  const index = headers.findIndex((header) => candidates.includes(header))
  if (index >= 0) return index
  for (const name of further) {
    const furtherIndex = headers.indexOf(name)
    if (furtherIndex >= 0) return furtherIndex
  }
  return -1
}

// Bitwarden writes every address of a login into its one `login_uri` cell, separated by commas, as its own importer
// reads them. Addresses without a scheme, which Bitwarden also keeps, are left out. An address with a query or
// fragment ends the list, since a comma after it may be part of that address rather than start another website. At
// most ten websites are saved, so one row cannot turn into an unbounded number of saved passwords.
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

/** The distinct website origins a cell names: one address, or the addresses of a Bitwarden `login_uri` list. */
function normalizedOrigins(value: string, list: boolean): string[] {
  if (!list) {
    const origin = normalizedOrigin(value)
    return origin ? [origin] : []
  }
  const origins = new Set<string>()
  for (const address of value.split(',')) {
    const origin = normalizedOrigin(address)
    if (origin) origins.add(origin)
    if (origins.size === MAX_ORIGINS_PER_ROW || /[?#]/.test(address)) break
  }
  return [...origins]
}

export function parseCredentialImportCsv(source: string): ParsedCredentialImport {
  if (source.includes('\u0000')) throw new CredentialImportError('invalid_csv')
  const rows = parseCsvRows(source, KEEPASS_1X_HEADER.test(source))
  const header = rows.shift()
  if (!header) throw new CredentialImportError('missing_columns')
  const headers = header.map(normalizedHeader)
  // Together these are the names Chrome's import reads; `login_uri`, `login_username` and `login_password` are
  // Bitwarden's. A file with one of the first names reads the column it always did, even beside an `account` column.
  // KeePass's CSV export puts the user name under `Login Name` and the entry's title under `Account`.
  const urlIndex = columnIndex(headers, ['url', 'website', 'origin'], ['loginuri', 'hostname'])
  const usernameIndex = columnIndex(headers, ['username', 'user', 'login'], ['loginusername', 'loginname', 'account'])
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
