import { javascriptLiteral } from './javascript-literal.js'

/**
 * The script that runs a page function in a page: the function's own source, called with these arguments. A value
 * goes as a JavaScript literal, and a function, such as a helper the page function takes, as its own source. So a page
 * function and its helpers use nothing but their parameters and the page's globals, as the architecture guards check
 * for every `.page.ts` file.
 */
export function pageScript<Args extends unknown[]>(run: (...args: Args) => unknown, ...args: NoInfer<Args>): string {
  const literals = args.map((value) => {
    if (typeof value === 'function') return `(${value.toString()})`
    return value === undefined ? 'undefined' : javascriptLiteral(value)
  })
  return `(${run.toString()})(${literals.join(', ')})`
}
