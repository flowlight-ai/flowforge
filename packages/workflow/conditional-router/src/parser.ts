/**
 * Recursive-descent parser for the condition language.
 *
 * Grammar (deliberately a strict subset — anything else is rejected up front):
 *
 *   program     := orExpr EOF
 *   orExpr      := andExpr ('or' andExpr)*
 *   andExpr     := notExpr ('and' notExpr)*
 *   notExpr     := 'not' notExpr | comparison
 *   comparison  := unary (compareOp unary)*          // chained, Python-style
 *   compareOp   := '==' | '!=' | '<' | '<=' | '>' | '>='
 *                | 'is' ['not'] | 'in' | 'not' 'in' | 'contains' literal
 *   unary       := '-' unary | postfix
 *   postfix     := primary ( '.' identifier | '[' orExpr ']' | 'exists' | 'not_empty' )*
 *   primary     := number | string | 'true' | 'false' | 'none'
 *                | identifier [ '(' (orExpr (',' orExpr)*)? ')' ]
 *                | '(' orExpr ')'
 *
 * Two deliberate parity choices from `conditional_router.py`:
 *   - **No binary arithmetic.** Python's `ast.BinOp` was never handled, so
 *     `1 + 2` was rejected; the tokenizer rejects the characters instead.
 *   - **`contains` takes a literal on the right.** Python's preprocessing
 *     regex only rewrote `<path> contains <string|number>`; accepting a bare
 *     identifier here would silently widen the contract.
 */

import { ExpressionError } from './errors.js';
import { tokenize, type Token } from './tokenizer.js';

/** Comparison operators that form chains. */
export type ComparisonOperator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'is'
  | 'is not'
  | 'in'
  | 'not in'
  | 'contains';

export type ExpressionNode =
  | { readonly kind: 'literal'; readonly value: null | boolean | number | string }
  | { readonly kind: 'identifier'; readonly name: string }
  | { readonly kind: 'member'; readonly object: ExpressionNode; readonly property: string }
  | { readonly kind: 'index'; readonly object: ExpressionNode; readonly index: ExpressionNode }
  | { readonly kind: 'call'; readonly callee: string; readonly args: readonly ExpressionNode[] }
  | { readonly kind: 'unary'; readonly operator: 'not' | '-'; readonly operand: ExpressionNode }
  /** Explicit parenthesisation; lets `exists` reject `(a.b) exists` like the source. */
  | { readonly kind: 'group'; readonly expression: ExpressionNode }
  | { readonly kind: 'logical'; readonly operator: 'and' | 'or'; readonly operands: readonly ExpressionNode[] }
  | {
      readonly kind: 'compare';
      readonly left: ExpressionNode;
      readonly operators: readonly ComparisonOperator[];
      readonly comparators: readonly ExpressionNode[];
    }
  | { readonly kind: 'exists'; readonly operand: ExpressionNode }
  | { readonly kind: 'notEmpty'; readonly operand: ExpressionNode };

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): ExpressionNode {
    const node = this.parseOr();
    const trailing = this.peek();
    if (trailing.type !== 'eof') {
      throw new ExpressionError(
        `Unexpected token '${trailing.value}' at position ${trailing.position}`,
      );
    }
    return node;
  }

  private peek(offset = 0): Token {
    const token = this.tokens[this.index + offset];
    if (token === undefined) {
      return { type: 'eof', value: '', position: this.tokens.at(-1)?.position ?? 0 };
    }
    return token;
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private matchKeyword(value: string): boolean {
    const token = this.peek();
    if (token.type === 'keyword' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private expectPunctuation(value: string): void {
    const token = this.peek();
    if (token.type !== 'punctuation' || token.value !== value) {
      throw new ExpressionError(
        `Expected '${value}' but found '${token.value || '<end>'}' at position ${token.position}`,
      );
    }
    this.index += 1;
  }

  private parseOr(): ExpressionNode {
    const first = this.parseAnd();
    if (!this.matchKeyword('or')) return first;
    const operands: ExpressionNode[] = [first, this.parseAnd()];
    while (this.matchKeyword('or')) operands.push(this.parseAnd());
    return { kind: 'logical', operator: 'or', operands };
  }

  private parseAnd(): ExpressionNode {
    const first = this.parseNot();
    if (!this.matchKeyword('and')) return first;
    const operands: ExpressionNode[] = [first, this.parseNot()];
    while (this.matchKeyword('and')) operands.push(this.parseNot());
    return { kind: 'logical', operator: 'and', operands };
  }

  private parseNot(): ExpressionNode {
    if (this.matchKeyword('not')) {
      return { kind: 'unary', operator: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExpressionNode {
    const left = this.parseUnary();
    const operators: ComparisonOperator[] = [];
    const comparators: ExpressionNode[] = [];
    for (;;) {
      const operator = this.tryComparisonOperator();
      if (operator === null) break;
      operators.push(operator);
      comparators.push(operator === 'contains' ? this.parseContainsOperand() : this.parseUnary());
    }
    if (operators.length === 0) return left;
    return { kind: 'compare', left, operators, comparators };
  }

  private tryComparisonOperator(): ComparisonOperator | null {
    const token = this.peek();
    if (token.type === 'operator' && ['==', '!=', '<', '<=', '>', '>='].includes(token.value)) {
      this.index += 1;
      return token.value as ComparisonOperator;
    }
    if (token.type !== 'keyword') return null;
    switch (token.value) {
      case 'is': {
        this.index += 1;
        return this.matchKeyword('not') ? 'is not' : 'is';
      }
      case 'in': {
        this.index += 1;
        return 'in';
      }
      case 'contains': {
        this.index += 1;
        return 'contains';
      }
      case 'not': {
        // Only `not in` is a comparison operator; a bare `not` belongs to parseNot.
        if (this.peek(1).type === 'keyword' && this.peek(1).value === 'in') {
          this.index += 2;
          return 'not in';
        }
        return null;
      }
      default:
        return null;
    }
  }

  /** `X contains Y` accepts a literal only (parity with the source regex). */
  private parseContainsOperand(): ExpressionNode {
    const token = this.peek();
    if (token.type === 'string') {
      this.index += 1;
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'number') {
      this.index += 1;
      return { kind: 'literal', value: token.numeric ?? Number(token.value) };
    }
    throw new ExpressionError(
      `'contains' expects a string or number literal, found '${token.value || '<end>'}' at position ${token.position}`,
    );
  }

  private parseUnary(): ExpressionNode {
    const token = this.peek();
    if (token.type === 'operator' && token.value === '-') {
      this.index += 1;
      return { kind: 'unary', operator: '-', operand: this.parseUnary() };
    }
    return this.parsePostfix();
  }

  private parsePostfix(): ExpressionNode {
    let node = this.parsePrimary();
    for (;;) {
      const token = this.peek();
      if (token.type === 'punctuation' && token.value === '.') {
        this.index += 1;
        const property = this.peek();
        if (property.type !== 'identifier') {
          throw new ExpressionError(
            `Expected property name after '.' but found '${property.value || '<end>'}' at position ${property.position}`,
          );
        }
        this.index += 1;
        if (this.peek().type === 'punctuation' && this.peek().value === '(') {
          throw new ExpressionError(
            'Only built-in function calls are allowed (method calls are not supported)',
          );
        }
        node = { kind: 'member', object: node, property: property.value };
        continue;
      }
      if (token.type === 'punctuation' && token.value === '[') {
        this.index += 1;
        const indexNode = this.parseOr();
        this.expectPunctuation(']');
        node = { kind: 'index', object: node, index: indexNode };
        continue;
      }
      if (token.type === 'keyword' && token.value === 'exists') {
        this.index += 1;
        assertPathChain(node, 'exists');
        node = { kind: 'exists', operand: node };
        continue;
      }
      if (token.type === 'keyword' && token.value === 'not_empty') {
        this.index += 1;
        assertPathChain(node, 'not_empty');
        node = { kind: 'notEmpty', operand: node };
        continue;
      }
      return node;
    }
  }

  private parsePrimary(): ExpressionNode {
    const token = this.next();
    if (token.type === 'number') {
      return { kind: 'literal', value: token.numeric ?? Number(token.value) };
    }
    if (token.type === 'string') {
      return { kind: 'literal', value: token.value };
    }
    if (token.type === 'keyword') {
      if (token.value === 'true') return { kind: 'literal', value: true };
      if (token.value === 'false') return { kind: 'literal', value: false };
      if (token.value === 'none') return { kind: 'literal', value: null };
      throw new ExpressionError(
        `Unexpected keyword '${token.value}' at position ${token.position}`,
      );
    }
    if (token.type === 'identifier') {
      if (this.peek().type === 'punctuation' && this.peek().value === '(') {
        this.index += 1;
        const args: ExpressionNode[] = [];
        if (!(this.peek().type === 'punctuation' && this.peek().value === ')')) {
          args.push(this.parseOr());
          while (this.peek().type === 'punctuation' && this.peek().value === ',') {
            this.index += 1;
            args.push(this.parseOr());
          }
        }
        this.expectPunctuation(')');
        return { kind: 'call', callee: token.value, args };
      }
      return { kind: 'identifier', name: token.value };
    }
    if (token.type === 'punctuation' && token.value === '(') {
      const inner = this.parseOr();
      this.expectPunctuation(')');
      return { kind: 'group', expression: inner };
    }
    throw new ExpressionError(
      `Unexpected token '${token.value || '<end>'}' at position ${token.position}`,
    );
  }
}

/**
 * `exists` / `not_empty` apply to a dotted/indexed path only — the source's
 * preprocessing regex rewrote `<path> exists` and left anything else as a
 * syntax error.
 */
function assertPathChain(node: ExpressionNode, sugar: string): void {
  if (node.kind === 'identifier' || node.kind === 'member' || node.kind === 'index') return;
  throw new ExpressionError(`'${sugar}' can only be applied to a state path`);
}

/** Parse `expression` into an AST, throwing {@link ExpressionError} if invalid. */
export function parseExpression(expression: string): ExpressionNode {
  if (expression.trim().length === 0) {
    throw new ExpressionError('Expression is empty');
  }
  return new Parser(tokenize(expression)).parse();
}
