import * as esprima from 'esprima';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type AnyNode = any;

function walk(node: AnyNode, visit: (node: AnyNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  for (const key of Object.keys(node)) {
    if (key === '_parent') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) walk(item, visit);
    } else if (val && typeof val === 'object') {
      walk(val, visit);
    }
  }
}

function traverseWithParent(node: AnyNode, visit: (node: AnyNode) => void, parent: AnyNode = null): void {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') {
    node._parent = parent;
    visit(node);
  }
  for (const key of Object.keys(node)) {
    if (key === '_parent') continue;
    const val = node[key];
    if (Array.isArray(val)) {
      for (const item of val) traverseWithParent(item, visit, node);
    } else if (val && typeof val === 'object') {
      traverseWithParent(val, visit, node);
    }
  }
}

export function findVarDefinition(varName: string, startLine: number, code: string): string | null {
  const codeLines = code.split('\n');
  const relevantCode = codeLines.slice(0, startLine - 1).join('\n');

  let subAst: AnyNode;
  try {
    subAst = esprima.parseScript(relevantCode, { loc: true, range: true, tolerant: true });
  } catch {
    return null;
  }

  const varDefs: Record<string, Array<{ line: number; value: string }>> = {};

  walk(subAst, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    if (!node.init) return;
    let idName: string | null = null;
    if (node.id && node.id.type === 'Identifier') idName = node.id.name;
    if (!idName) return;
    const absLine = node.loc && node.loc.start ? node.loc.start.line : null;
    if (absLine === null || absLine >= startLine) return;
    let value: string;
    if (node.init.range) {
      value = relevantCode.slice(node.init.range[0], node.init.range[1]).trim();
    } else if (node.init) {
      value = String(node.init);
    } else {
      value = '';
    }
    if (!varDefs[idName]) varDefs[idName] = [];
    varDefs[idName]!.push({ line: absLine, value });
  });

  let lastResolved: string | null = null;
  let defLine: number | null = null;

  if (varName in varDefs) {
    const defs = varDefs[varName]!.slice().sort((a, b) => b.line - a.line);
    for (const defn of defs) {
      if (
        !defn.value.includes('btoa') &&
        !defn.value.includes('XOR_STR') &&
        !defn.value.includes('doubleXOR') &&
        !defn.value.includes('singlebtoa')
      ) {
        lastResolved = defn.value;
        defLine = defn.line;
        break;
      }
    }

    if (lastResolved) {
      const resolvedVarsCache: Record<string, string> = {};

      function resolveVarRecursive(expr: string, varLine: number): string {
        let exprAst: AnyNode;
        try {
          exprAst = esprima.parseScript(expr, { loc: true, range: true, tolerant: true });
        } catch {
          return expr;
        }

        const varsSet = new Set<string>();

        traverseWithParent(exprAst, (node) => {
          if (node.type !== 'Identifier' || !node.name) return;
          const parent = node._parent;
          if (parent) {
            const parentType = parent.type;
            if (
              (parentType === 'MemberExpression' && parent.property === node && !parent.computed) ||
              (parentType === 'ObjectProperty' && parent.key === node && !parent.computed) ||
              (parentType === 'VariableDeclarator' && parent.id === node) ||
              (parentType === 'FunctionDeclaration' && parent.id === node) ||
              (parentType === 'FunctionExpression' && parent.id === node) ||
              node.name === 'window'
            ) {
              return;
            }
          }
          varsSet.add(node.name);
        });

        if (varsSet.size === 0) return expr;

        for (const v of varsSet) {
          if (v in resolvedVarsCache) continue;
          let defValue = v;
          if (v in varDefs) {
            const sorted = varDefs[v]!.slice().sort((a, b) => b.line - a.line);
            for (const defn of sorted) {
              if (
                defn.line < varLine &&
                !defn.value.includes('btoa') &&
                !defn.value.includes('XOR_STR') &&
                !defn.value.includes('doubleXOR') &&
                !defn.value.includes('singlebtoa')
              ) {
                defValue = defn.value;
                break;
              }
            }
          }
          resolvedVarsCache[v] = defValue;
          resolvedVarsCache[v] = resolveVarRecursive(defValue, varLine);
        }

        let finalExpr = expr;
        for (const [k, val] of Object.entries(resolvedVarsCache)) {
          finalExpr = finalExpr.replace(new RegExp('\\b' + escapeRegExp(k) + '\\b', 'g'), String(val));
        }
        return finalExpr;
      }

      lastResolved = resolveVarRecursive(lastResolved, defLine!);

      if (lastResolved) {
        const escapedVarName = escapeRegExp(varName);

        const doubleXorRe = new RegExp(
          `XOR_STR\\s*\\(\\s*${escapedVarName}\\s*,\\s*${escapedVarName}\\s*\\)`,
          'g',
        );
        const xorMatches = code.match(doubleXorRe) || [];
        if (xorMatches.length >= 2) {
          lastResolved = `doublexor(${lastResolved})`;
        } else {
          const usageLineIndex = startLine - 1;
          const searchStart = Math.max(0, usageLineIndex - 10);
          const relevantLines = codeLines.slice(searchStart, usageLineIndex + 1).join('\n');

          const btoaRe = new RegExp(`btoa\\s*\\(\\s*""\\s*\\+\\s*${escapedVarName}\\s*\\)`, 'g');
          const xorVarPattern = new RegExp(`XOR_STR\\s*\\(\\s*${escapedVarName}\\s*,`, 'g');

          const btoaMatches = relevantLines.match(btoaRe) || [];
          const hasXorVar = xorVarPattern.test(relevantLines);

          if (btoaMatches.length === 1 && !hasXorVar) {
            lastResolved = `singlebtoa(${lastResolved})`;
          }
        }
      }
    }
  }

  return lastResolved;
}

export function parseAssignmentsLoc(code: string): Record<string, string> {
  let ast: AnyNode;
  try {
    ast = esprima.parseScript(code, { loc: true, jsx: true });
  } catch {
    return {};
  }

  const stringifyCalls: string[] = [];

  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return;
    const callee = node.callee;
    if (
      callee &&
      callee.type === 'MemberExpression' &&
      callee.object &&
      callee.object.name === 'JSON' &&
      callee.property &&
      callee.property.name === 'stringify' &&
      node.arguments &&
      node.arguments[0] &&
      node.arguments[0].type === 'Identifier'
    ) {
      stringifyCalls.push(node.arguments[0].name);
    }
  });

  const lastStringifyArg = stringifyCalls.length ? stringifyCalls[stringifyCalls.length - 1] : null;
  if (!lastStringifyArg) return {};

  const varValues: Record<string, string | number | boolean | null> = {};

  walk(ast, (node) => {
    if (node.type !== 'VariableDeclarator') return;
    const idNode = node.id;
    const initNode = node.init;
    if (
      idNode &&
      idNode.type === 'Identifier' &&
      initNode &&
      ['Literal', 'NumericLiteral', 'StringLiteral'].includes(initNode.type)
    ) {
      varValues[idNode.name] = initNode.value;
    }
  });

  const assignments: Record<string, string> = {};

  walk(ast, (node) => {
    if (node.type !== 'AssignmentExpression') return;
    const left = node.left;
    const right = node.right;
    if (
      left &&
      left.type === 'MemberExpression' &&
      left.object &&
      left.object.type === 'Identifier' &&
      left.object.name === lastStringifyArg &&
      left.property &&
      left.property.type === 'Identifier' &&
      right &&
      right.type === 'Identifier' &&
      node.loc
    ) {
      const keyVar = left.property.name;
      const value = right.name;
      const key = keyVar in varValues ? varValues[keyVar] : keyVar;
      const resolved = findVarDefinition(value, node.loc.start.line, code) || value;
      assignments[String(key)] = resolved;
    }
  });

  return assignments;
}

export function getXorKey(jsCode: string): string | null {
  let parsed: AnyNode;
  try {
    parsed = esprima.parseScript(jsCode, { tolerant: true });
  } catch {
    return null;
  }

  let lastXorCall: AnyNode = null;
  let secondArgNode: AnyNode = null;

  for (const node of parsed.body || []) {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.init && decl.init.type === 'CallExpression') {
          const call = decl.init;
          if (call.callee.type === 'Identifier' && call.callee.name === 'XOR_STR') {
            lastXorCall = call;
            secondArgNode = call.arguments[1];
          }
        }
      }
    }
  }

  if (!lastXorCall) return null;

  if (secondArgNode.type === 'Identifier') {
    const varName = secondArgNode.name;
    const findValue = (nodes: AnyNode[], name: string): string | null => {
      for (const n of nodes) {
        if (n.type === 'VariableDeclaration') {
          for (const decl of n.declarations) {
            if (decl.id.name === name && decl.init && decl.init.type === 'Literal') {
              return decl.init.value;
            }
          }
        } else if (n.type === 'ExpressionStatement' && n.expression.type === 'AssignmentExpression') {
          const expr = n.expression;
          if (expr.left.type === 'Identifier' && expr.left.name === name && expr.right.type === 'Literal') {
            return expr.right.value;
          }
        }
      }
      return null;
    };
    return findValue(parsed.body || [], varName);
  } else if (secondArgNode.type === 'Literal') {
    return secondArgNode.value;
  } else {
    return null;
  }
}

export function parseKeys(decompiledCode: string): [string | null, Record<string, string>] {
  const assignments = parseAssignmentsLoc(decompiledCode);
  const xorKey = getXorKey(decompiledCode);

  const parsedKeys: Record<string, string> = {};
  let randomindex = 1;

  for (const [key0, value0] of Object.entries(assignments)) {
    const key = String(key0);
    const value = String(value0);
    if (value.startsWith('Array') && !value.includes('location')) {
      const after = value.split(') : ')[1];
      if (after) {
        const numbers = after.split(' + ');
        const num1 = parseFloat(numbers[0]!);
        const num2 = parseFloat(numbers[1]!);
        parsedKeys[key] = String(num1 + num2);
      } else {
        parsedKeys[key] = value;
      }
    } else if (value.includes('location')) {
      parsedKeys[key] = 'location';
    } else if (value.includes('cfIpLongitude')) {
      parsedKeys[key] = 'ipinfo';
    } else if (value.includes('maxTouchPoints')) {
      parsedKeys[key] = 'vendor';
    } else if (value.includes('history')) {
      parsedKeys[key] = 'history';
    } else if (value.includes('window["Object"]["keys"]')) {
      parsedKeys[key] = 'localstorage';
    } else if (value.includes('createElement')) {
      parsedKeys[key] = 'element';
    } else if (/^\d+$/.test(value)) {
      parsedKeys[key] = value;
    } else if (value.includes('random')) {
      parsedKeys[key] = 'random_' + randomindex;
      randomindex += 1;
    } else if (value.includes('doublexor')) {
      parsedKeys[key] = value;
    } else if (value.includes('singlebtoa')) {
      parsedKeys[key] = value;
    }
  }

  return [xorKey, parsedKeys];
}