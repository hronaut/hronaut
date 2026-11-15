/** A question Hronaut's own pages ask before a change, such as deleting a workspace: the question, and what follows it. */
export interface Confirmation {
  message: string
  detail?: string
}

type ConfirmationParameters = Record<string, string | number>

/** A question mark that ends the question: before a space, a line break, the end, or a parameter. */
const QUESTION_END = /[?\uFF1F](?=\s|$|\uE000)/u
const HELD_PARAMETER = /\uE000(\d+)\uE000/gu

/**
 * Splits a confirmation after its question, so its dialog can show "Close workspace \"Work\"?" as its headline and what
 * the change means under it. `format` writes the whole message from `parameters`, as a translation does. The question
 * is found with every text parameter held out, so a workspace name with a question mark in it stays whole. A message
 * with nothing after its question stays one headline.
 */
export function splitConfirmation(format: (parameters: ConfirmationParameters) => string, parameters: ConfirmationParameters = {}): Confirmation {
  const held: string[] = []
  const holders = Object.fromEntries(Object.entries(parameters).map(([name, value]) => {
    if (typeof value !== 'string') return [name, value]
    held.push(value)
    return [name, `\uE000${held.length - 1}\uE000`]
  }))
  const text = format(holders)
  const restore = (part: string): string => part.replace(HELD_PARAMETER, (_holder, index: string) => held[Number(index)] ?? '')
  const end = QUESTION_END.exec(text)
  const detail = end ? restore(text.slice(end.index + 1)).trim() : ''
  if (!end || !detail) return { message: restore(text).trim() }
  return { message: restore(text.slice(0, end.index + 1)).trim(), detail }
}
