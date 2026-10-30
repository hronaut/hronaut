/**
 * The text of a page script before and after the one page function it embeds. The bundled app and the test runner
 * write a function's source differently, so a test that recognizes a script the app runs matches these two parts,
 * the start and the end of the script, instead of the whole script.
 */
export function aroundPageFunction(script: string, pageFunction: (...args: never[]) => unknown): { before: string; after: string } {
  const parts = script.split(pageFunction.toString())
  if (parts.length !== 2) throw new Error(`The script does not embed ${pageFunction.name} exactly once`)
  return { before: parts[0]!, after: parts[1]! }
}
