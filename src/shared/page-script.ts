import { javascriptLiteral } from './javascript-literal.js'

/**
 * The source a page can call: a function declaration or expression, or an arrow function. A method's source, such as
 * `read() {}`, is no expression, and a bound or built-in function has no source, so either throws.
 */
function callableSource(fn: (...args: never[]) => unknown): string {
  const source = fn.toString()
  if (!/^(?:async\s+)?(?:function\b|\(|[\w$]+\s*=>)/.test(source) || /\{\s*\[native code\]\s*\}$/.test(source)) {
    throw new TypeError(`${fn.name || 'This function'} cannot run in a page: pass a function declaration, function expression or arrow function`)
  }
  return source
}

/**
 * The script that runs a page function in a page: the function's own source, called with these arguments. A value
 * goes as a JavaScript literal, and a function, such as a helper the page function takes, as its own source. So a page
 * function and its helpers use nothing but their parameters and the page's globals, as the architecture guards check
 * for every `.page.ts` file.
 */
export function pageScript<Args extends unknown[]>(run: (...args: Args) => unknown, ...args: NoInfer<Args>): string {
  const literals = args.map((value) => {
    if (typeof value === 'function') return `(${callableSource(value as (...args: never[]) => unknown)})`
    return value === undefined ? 'undefined' : javascriptLiteral(value)
  })
  return `(${callableSource(run)})(${literals.join(', ')})`
}
