const MAPPING: Record<string, string> = {
  '1': 'XOR_STR',
  '2': 'SET_VALUE',
  '3': 'BTOA',
  '4': 'BTOA_2',
  '5': 'ADD_OR_PUSH',
  '6': 'ARRAY_ACCESS',
  '7': 'CALL',
  '8': 'COPY',
  '10': 'window',
  '11': 'GET_SCRIPT_SRC',
  '12': 'GET_MAP',
  '13': 'TRY_CALL',
  '14': 'JSON_PARSE',
  '15': 'JSON_STRINGIFY',
  '17': 'CALL_AND_SET',
  '18': 'ATOB',
  '19': 'BTOA_3',
  '20': 'IF_EQUAL_CALL',
  '21': 'IF_DIFF_CALL',
  '22': 'TEMP_STACK_CALL',
  '23': 'IF_DEFINED_CALL',
  '24': 'BIND_METHOD',
  '27': 'REMOVE_OR_SUBTRACT',
  '28': 'undefined',
  '25': 'undefined',
  '26': 'undefined',
  '29': 'LESS_THAN',
  '31': 'INCREMENT',
  '32': 'DECREMENT_AND_EXEC',
  '33': 'MULTIPLY',
  '34': 'MOVE',
};

const FUNCTIONS: Record<string, string> = {
  XOR_STR: `function XOR_STR(e, t) {
        e = String(e);
        t = String(t);
        let n = "";
        for (let r = 0; r < e.length; r++)
            n += String.fromCharCode(e.charCodeAt(r) ^ t.charCodeAt(r % t.length));
        return n;
    }
    `,
};

export function pyStr(v: unknown): string {
  if (v === null) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return '[' + v.map(pyStr).join(', ') + ']';
  if (typeof v === 'object') {
    const parts: string[] = [];
    for (const k of Object.keys(v)) parts.push(`'${k}': ${pyStr((v as Record<string, unknown>)[k])}`);
    return '{' + parts.join(', ') + '}';
  }
  return String(v);
}

export function pyFloat(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') throw new Error('empty');
  if (/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^[+-]?(inf|infinity)$/i.test(t)) return /^\+?inf/i.test(t) ? Infinity : -Infinity;
  if (/^nan$/i.test(t)) return NaN;
  throw new Error('invalid number');
}

interface PotentialEntry {
  var: string;
  key: string;
}

export class Decompiler {
  mapping: Record<string, string>;
  xorkey = '';
  xorkey2 = '';
  decompiled = 'var mem = {};\n';
  array_dict: Record<string, string | string[]> = {};
  vg = 0;
  round1 = 0;
  found = false;
  potential: PotentialEntry[] = [];

  constructor() {
    this.mapping = { ...MAPPING };
  }

  start() {
    this.mapping = { ...MAPPING };
    this.xorkey = '';
    this.xorkey2 = '';
    this.decompiled = 'var mem = {};\n';
    this.array_dict = {};
    this.vg = 0;
    this.round1 = 0;
    this.found = false;
    this.potential = [];
  }

  xS(e: string, t: string): string {
    let n = '';
    for (let r = 0; r < e.length; r++) {
      n += String.fromCharCode(e.charCodeAt(r) ^ t.charCodeAt(r % t.length));
    }
    return n;
  }

  handleOperation(operation: string, args: string[]): void {
    if (operation === 'COPY') {
      const fromKey = args[1]!;
      this.mapping[args[0]!] = this.mapping[fromKey]!;
      if (this.mapping[fromKey] !== 'window') {
        if (
          this.mapping[args[1]!]! in FUNCTIONS &&
          !this.decompiled.includes(`function ${this.mapping[args[1]!]!}`)
        ) {
          this.decompiled += FUNCTIONS[this.mapping[args[1]!]!] + '\n';
        }
      } else {
        const var_name = args[1]!.replace(/\./g, '_');
        this.decompiled += `var var_${var_name} = window;\n`;
        this.array_dict[args[1]!] = 'window';
      }
    } else if (operation === 'SET_VALUE') {
      const var_name = args[0]!.replace(/\./g, '_');
      const value = args[1];
      let num: unknown;
      let parsedNum = true;
      try {
        num = pyFloat(value);
      } catch {
        parsedNum = false;
      }
      if (parsedNum) {
        this.decompiled += `var var_${var_name} = ${num};\n`;
        this.array_dict[args[0]!] = String(num);
      } else if (typeof value === 'string') {
        if (value === '[]') {
          this.decompiled += `var var_${var_name} = [];\n`;
          this.array_dict[args[0]!] = [];
        } else if (value === 'None') {
          this.decompiled += `var var_${var_name} = null;\n`;
          this.array_dict[args[0]!] = 'null';
        } else {
          this.decompiled += `var var_${var_name} = "${value}";\n`;
          this.array_dict[args[0]!] = `"${value}"`;
        }
      } else if (Array.isArray(value)) {
        this.decompiled += `var var_${var_name} = [];\n`;
        this.array_dict[args[0]!] = [];
      } else if (value === null) {
        this.decompiled += `var var_${var_name} = null;\n`;
        this.array_dict[args[0]!] = 'null';
      } else {
        this.decompiled += `var var_${var_name} = ${value};\n`;
        this.array_dict[args[0]!] = String(value);
      }
    } else if (operation === 'ARRAY_ACCESS') {
      this.handleArrayAccess(args);
    } else if (operation === 'BIND_METHOD') {
      this.handleBindMethod(args);
    } else if (operation === 'XOR_STR') {
      if (this.round1 === 1 && this.potential.length < 2) {
        this.potential.push({ var: args[0]!, key: args[1]! });
      }
      const var_name = args[0]!.replace(/\./g, '_');
      const key_name = args[1]!.replace(/\./g, '_');
      this.decompiled += `var var_${var_name} = XOR_STR(var_${var_name}, var_${key_name});\n`;
    } else if (operation === 'BTOA_3') {
      const var_name = args[0]!.replace(/\./g, '_');
      this.decompiled += `var var_${var_name} = btoa("" + var_${var_name});\n`;
    } else if (operation === 'CALL_AND_SET') {
      const var_name = args[0]!.replace(/\./g, '_');
      const func_name = args[1]!.replace(/\./g, '_');
      const args_str = args.slice(2).map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
      this.decompiled += `var var_${var_name} = var_${func_name}(${args_str});\n`;
    } else if (operation === 'IF_DEFINED_CALL') {
      this.handleIfDefinedCall(args);
    } else if (operation === 'CALL') {
      this.handleCallOperation(args);
    } else if (operation === 'ADD_OR_PUSH') {
      const var_name = args[0]!.replace(/\./g, '_');
      const arg_name = args[1]!.replace(/\./g, '_');
      this.decompiled += `var var_${var_name} = Array.isArray(var_${var_name}) ? (var_${var_name}.push(var_${arg_name}), var_${var_name}) : var_${var_name} + var_${arg_name};\n`;
    } else if (operation === 'IF_DIFF_CALL') {
      const var_0 = args[0]!.replace(/\./g, '_');
      const var_1 = args[1]!.replace(/\./g, '_');
      const var_2 = args[2]!.replace(/\./g, '_');
      if (this.mapping[args[3]!] === 'COPY') {
        const var_4 = args[4]!.replace(/\./g, '_');
        const var_5 = args[5]!.replace(/\./g, '_');
        this.decompiled += `Math.abs(var_${var_0} - var_${var_1}) > var_${var_2} ? var_${var_4} = var_${var_5} : null;\n`;
      } else {
        const args_str = args.slice(4).map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
        this.decompiled += `Math.abs(var_${var_0} - var_${var_1}) > var_${var_2} ? ${this.mapping[args[3]!]}(${args_str}) : null;\n`;
      }
    } else if (operation === 'TRY_CALL') {
      this.handleTryCall(args);
    } else if (operation === 'JSON_STRINGIFY') {
      const var_name = args[0]!.replace(/\./g, '_');
      this.decompiled += `var var_${var_name} = JSON.stringify(var_${var_name});\n`;
    } else if (operation === 'MOVE') {
      this.decompiled += `MOVE ${args}`;
    } else {
      const mapped = args.slice(1).filter((key) => key in this.mapping).map((key) => this.mapping[key]);
      const unlabeled = args.slice(1).filter((key) => !(key in this.mapping)).map(String);
      const all_values = mapped.concat(unlabeled).join(' ');
      this.decompiled += `// UNKNOWN: ${operation} -> ${args[0]} ${all_values};\n`;
    }
  }

  handleTryCall(args: string[]): void {
    const target_var = `var_${args[0]!.replace(/\./g, '_')}`;
    const fn = this.mapping[args[1]!] || '';
    const rest_args = args.slice(2).map((a) => `var_${a.replace(/\./g, '_')}`);
    if (fn === 'ARRAY_ACCESS') {
      this.decompiled += `try { mem[${rest_args[0]}] = ${rest_args[1]}[${rest_args[0]}]; } catch(r) { ${target_var} = "" + r; }\n`;
    } else {
      const args_str = rest_args.join(', ');
      this.decompiled += `try { ${fn}(${args_str}); } catch(r) { ${target_var} = "" + r; }\n`;
    }
  }

  handleArrayAccess(args: string[]): void {
    const var_0 = args[0]!.replace(/\./g, '_');
    const var_1 = args[1]!.replace(/\./g, '_');
    const var_2 = args[2]!.replace(/\./g, '_');
    if (this.decompiled.includes(`var var_${var_1} =`)) {
      if (args[1]! in this.array_dict || args[2]! in this.array_dict) {
        if (args[2]! in this.array_dict && !(args[1]! in this.array_dict)) {
          this.decompiled += `var var_${var_0} = var_${var_1}[${this.array_dict[args[2]!]}];\n`;
        } else if (args[1]! in this.array_dict && !(args[2]! in this.array_dict)) {
          this.decompiled += `var var_${var_0} = ${this.array_dict[args[1]!]}[var_${var_2}];\n`;
        } else {
          if (new RegExp(`var\\s+var_${var_1}\\s*=\\s*\\w+\\([^)]*\\)`).test(this.decompiled)) {
            this.decompiled += `var var_${var_0} = var_${var_1}[${this.array_dict[args[2]!]}];\n`;
            this.array_dict[args[0]!] = `var_${var_1}[${this.array_dict[args[2]!]}]`;
          } else {
            this.decompiled += `var var_${var_0} = ${this.array_dict[args[1]!]}[${this.array_dict[args[2]!]}];\n`;
            this.array_dict[args[0]!] = `${this.array_dict[args[1]!]}[${this.array_dict[args[2]!]}]`;
          }
        }
      } else {
        this.decompiled += `var var_${var_0} = var_${var_1}[var_${var_2}];\n`;
      }
    } else {
      this.decompiled += `var var_${var_0} = window[var_${var_2}];\n`;
    }
  }

  handleBindMethod(args: string[]): void {
    const var_0 = args[0]!.replace(/\./g, '_');
    const var_1 = args[1]!.replace(/\./g, '_');
    const var_2 = args[2]!.replace(/\./g, '_');
    if (this.decompiled.includes(`var var_${var_1} =`)) {
      if (args[1]! in this.array_dict || args[2]! in this.array_dict) {
        if (args[1]! in this.array_dict && !(args[2]! in this.array_dict)) {
          this.decompiled += `var var_${var_0} = ${this.array_dict[args[1]!]}[var_${var_2}].bind(${this.array_dict[args[1]!]});\n`;
        } else {
          if (new RegExp(`var\\s+var_${var_1}\\s*=\\s*\\w+\\([^)]*\\)`).test(this.decompiled)) {
            this.decompiled += `var var_${var_0} = var_${var_1}[${this.array_dict[args[2]!]}].bind(var_${var_1});\n`;
            this.array_dict[args[0]!] = `var_${var_1}[${this.array_dict[args[2]!]}]`;
          } else {
            this.decompiled += `var var_${var_0} = ${this.array_dict[args[1]!]}[${this.array_dict[args[2]!]}].bind(${this.array_dict[args[1]!]});\n`;
            this.array_dict[args[0]!] = `${this.array_dict[args[1]!]}[${this.array_dict[args[2]!]}]`;
          }
        }
      } else {
        this.decompiled += `var var_${var_0} = var_${var_1}[var_${var_2}].bind(var_${var_1});\n`;
      }
    } else {
      this.decompiled += `var var_${var_0} = window[var_${var_2}].bind(var_${var_1});\n`;
    }
  }

  handleIfDefinedCall(args: string[]): void {
    const result: Array<string | null> = [];
    for (const item of args) {
      if (item in this.mapping) {
        const keys = Object.keys(this.mapping).filter((k) => this.mapping[k] === this.mapping[item] && k !== item);
        result.push(keys.length ? keys[0]! : null);
      } else {
        result.push(null);
      }
    }
    for (let idx = 0; idx < result.length; idx++) {
      const key = result[idx];
      if (key === null || key === undefined) {
        result[idx] = null;
      } else {
        const others = Object.keys(this.mapping).filter((k) => this.mapping[k] === this.mapping[key] && k !== key);
        result[idx] = others.length ? others[0]! : null;
      }
    }

    if (args.length === 4) {
      const target = args[3]!.replace(/\./g, '_');
      const count = (this.decompiled.match(new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      if (count <= 1 && !this.decompiled.includes(`var var_${args[2]!.replace(/\./g, '_')}`)) {
        if (!this.xorkey) {
          this.xorkey = String(args[3]);
        }
        const var_0 = args[0]!.replace(/\./g, '_');
        if (this.mapping[result[1]!] === 'SET_VALUE') {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (mem["${args[2]}"] = "${args[3]}", var_${var_0}) : var_${var_0};\n`;
        } else {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (${this.mapping[result[1]!]}("${args[2]}", "${args[3]}") || var_${var_0}) : var_${var_0};\n`;
        }
      } else if (count <= 3) {
        const var_0 = args[0]!.replace(/\./g, '_');
        const arg_2 = args[2]!.replace(/\./g, '_');
        if (this.mapping[result[1]!] === 'SET_VALUE') {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? ((mem["${args[2]}"] = "${args[3]}") || var_${var_0}) : var_${var_0};\n`;
        } else {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (${this.mapping[result[1]!]}(var_${arg_2}, mem["${args[3]}"]) || var_${var_0}) : var_${var_0};\n`;
        }
      } else if (this.mapping[result[1]!] === 'JSON_PARSE') {
        const var_0 = args[0]!.replace(/\./g, '_');
        const arg_3 = args[3]!.replace(/\./g, '_');
        this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (JSON.parse(var_${arg_3}) || var_${var_0}) : var_${var_0};\n`;
      } else {
        const var_0 = args[0]!.replace(/\./g, '_');
        const args_str = args.slice(2).map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
        this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (${this.mapping[result[1]!]}(${args_str}) || var_${var_0}) : var_${var_0};\n`;
      }
    } else {
      const var_0 = args[0]!.replace(/\./g, '_');
      if (args.length > 4 && this.decompiled.includes(`mem["${args[4]}"] =`)) {
        const parts = args.slice(2).map((arg, i) => (i + 2 === 3 ? `mem["${arg}"]` : `var_${arg.replace(/\./g, '_')}`));
        const args_str = parts.join(', ');
        if (this.mapping[result[1]!] === 'CALL') {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (var_${args[2]!.replace(/\./g, '_')}(${args_str}) || var_${var_0}) : var_${var_0};\n`;
        } else {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (${this.mapping[result[1]!]}(${args_str}) || var_${var_0}) : var_${var_0};\n`;
        }
      } else {
        const args_str = args.slice(2).map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
        if (this.mapping[result[1]!] === 'ATOB') {
          const arg_2 = args[2]!.replace(/\./g, '_');
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (atob("" + var_${arg_2}) || var_${var_0}) : var_${var_0};\n`;
        } else if (args.length >= 3 && result[1]! in this.mapping) {
          this.decompiled += `var var_${var_0} = var_${var_0} !== void 0 ? (${this.mapping[result[1]!]}(${args_str}) || var_${var_0}) : var_${var_0};\n`;
        } else {
          this.decompiled += `// ERROR: Invalid IF_DEFINED_CALL with args ${args};\n`;
        }
      }
    }
  }

  handleCallOperation(args: string[]): void {
    if (args[0]! in this.mapping) {
      if (this.mapping[args[0]!] === 'BTOA') {
        const arg_1 = args[1]!.replace(/\./g, '_');
        this.decompiled += `console.log(btoa("" + var_${arg_1}));\n`;
      } else {
        const args_str = args.map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
        this.decompiled += `${this.mapping[args[0]!]}(${args_str});\n`;
      }
    } else {
      if (this.decompiled.includes(`var var_${args[0]!.replace(/\./g, '_')} = "set";`)) {
        const arg_1 = args[1]!.replace(/\./g, '_');
        const arg_2 = args[2]!.replace(/\./g, '_');
        const arg_3 = args[3]!.replace(/\./g, '_');
        this.decompiled += `var_${arg_1}[var_${arg_2}] = var_${arg_3};\n`;
      } else {
        const args_str = args.slice(1).map((arg) => `var_${arg.replace(/\./g, '_')}`).join(', ');
        this.decompiled += `var_${args[0]!.replace(/\./g, '_')}(${args_str});\n`;
      }
    }
  }

  removeUnusedVariables(): void {
    const lines = this.decompiled.split('\n');
    const usedVars = new Set<string>();
    const varDeclLines: Array<{ name: string; index: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const m = /^var\s+var_([\w_]+)\s*=/.exec(lines[i]!);
      if (m) varDeclLines.push({ name: m[1]!, index: i });
    }

    for (const v of varDeclLines) {
      const name = v.name;
      const isUsed = lines.some((line) => line.includes(name) && !line.startsWith(`var var_${name} =`));
      if (isUsed) usedVars.add(name);
    }

    this.decompiled = lines
      .filter((line) => {
        const m = /^var\s+var_([\w_]+)\s*=/.exec(line);
        if (!m) return true;
        return usedVars.has(m[1]!);
      })
      .join('\n');
  }

  decompile(bytecode: unknown[][]): void {
    while (bytecode.length > 0) {
      const e = String(bytecode[0]![0]);
      const t = bytecode[0]!.slice(1).map(pyStr);
      bytecode.shift();
      this.vg += 1;

      if (e in this.mapping) {
        this.handleOperation(this.mapping[e]!, t);
      } else {
        this.decompiled += `// UNKNOWN_OPCODE ${e} -> ${t.join(', ')};\n`;
      }

      if (this.mapping[e] === 'CALL' && !this.found) {
        for (const entry of this.potential) {
          if (t.length > 3 && entry.var === t[3]) {
            const keyStr = entry.key.replace(/\./g, '_');
            const regex = new RegExp(`var var_${keyStr} = (.*);`);
            const match = regex.exec(this.decompiled);
            if (match) {
              this.xorkey2 = match[1]!.replace(/;/, '');
            }
            this.found = true;
            break;
          }
        }
      }
    }

    if (this.round1 === 0) {
      this.round1 += 1;
      this.decompile2();
    }
  }

  decompile2(): void {
    const matches = this._findStringLiterals();
    const bytecode = matches.reduce((a, b) => (b.length > a.length ? b : a), '');
    if (bytecode) {
      const decoded = JSON.parse(
        this.xS(Buffer.from(bytecode, 'base64').toString('utf8'), this.xorkey),
      ) as unknown[][];
      this.decompile(decoded);
    }
    if (this.round1 === 1) {
      this.round1 += 1;
      this.decompile3();
    }
  }

  decompile3(): void {
    const matches = this._findStringLiterals();
    const bytecode = matches.find((s) => s.length >= 60 && s.length <= 200) || '';
    if (bytecode) {
      const decoded = JSON.parse(
        this.xS(Buffer.from(bytecode, 'base64').toString('utf8'), this.xorkey),
      ) as unknown[][];
      this.decompile(decoded);
    }
    this.removeUnusedVariables();
  }

  _findStringLiterals(): string[] {
    const matches: string[] = [];
    const re = /var\s+\w+\s*=\s*(['"`])([\s\S]*?)\1/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(this.decompiled))) {
      matches.push(m[2]!);
    }
    return matches;
  }

  static decompileVm(turnstile: string, token: string): string {
    const d = new Decompiler();
    d.start();
    d.decompiled =
      'const { JSDOM } = require("jsdom");\n' +
      'const dom = new JSDOM("<!DOCTYPE html><p>Hello world</p>", { url: "https://chatgpt.com/" });\n' +
      'const window = dom.window;\n' +
      'var mem = {};\n';
    d.decompile(JSON.parse(d.xS(Buffer.from(turnstile, 'base64').toString('utf8'), token)) as unknown[][]);
    return d.decompiled;
  }
}