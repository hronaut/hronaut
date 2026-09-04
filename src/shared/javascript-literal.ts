export function javascriptLiteral(value: unknown): string {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new TypeError('Value cannot be represented as a JavaScript literal')
  return serialized.replace(/[<>\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`
  )
}
