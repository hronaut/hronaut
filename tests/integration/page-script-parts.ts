/**
 * The start of a page script that runs this page function. The bundled app and the test runner write a function's
 * source differently, so a test that recognizes a script the app runs matches this start, which names the function,
 * and the arguments it can tell apart, instead of the whole script.
 */
export function pageScriptStart(pageFunction: (...args: never[]) => unknown): string {
  return `(${pageFunction.constructor.name === 'AsyncFunction' ? 'async ' : ''}function ${pageFunction.name}(`
}
