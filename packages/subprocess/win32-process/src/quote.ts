/**
 * Command-line quoting helpers matching CommandLineToArgvW semantics. These
 * are pure and platform-independent, so a caller that funnels the produced
 * line through `node:child_process` gets the same argv split as the Win32
 * runtime used by CreateProcess-style spawns.
 * @module @flowforge/win32-process/quote
 */

/**
 * Quote one argument according to CommandLineToArgvW parsing.
 * @param argument - one argv entry.
 * @returns bare or quoted command-line segment.
 */
export function quoteArg(argument: string): string {
  if (argument === '') return '""'
  if (!/[\s"]/u.test(argument)) return argument
  let quoted = '"'
  for (let index = 0; index < argument.length; index++) {
    let backslashes = 0
    while (index < argument.length && argument.charAt(index) === '\\') {
      backslashes += 1
      index += 1
    }
    if (index === argument.length) {
      quoted += '\\'.repeat(backslashes * 2)
    } else if (argument.charAt(index) === '"') {
      quoted += '\\'.repeat(backslashes * 2 + 1) + '"'
    } else {
      quoted += '\\'.repeat(backslashes) + argument.charAt(index)
    }
  }
  return quoted + '"'
}

/**
 * Build the mutable command line accepted by a CreateProcess-family call.
 * @param program - executable argv entry.
 * @param args - remaining argv entries.
 * @returns joined command-line.
 */
export function buildCommandLine(program: string, args: readonly string[]): string {
  return [program, ...args].map(quoteArg).join(' ')
}