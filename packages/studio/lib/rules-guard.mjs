/**
 * The wall around rules, at build: a parser pass that refuses what rules may not use, with the line named, and
 * rewrites what is left so that it runs counted and guarded (rooms-milestone-1-design.md, section 10).
 *
 * A game's rules run in the same isolate as its studio's site, accounts and shop until rules get an isolate of their
 * own. So `homie-studio build` never puts a rules module into the Worker as its author wrote it:
 *
 *   1  every file the rules are made of (`rules.ts`, `move.ts`, and the game's own files they import) has its types
 *      removed (esbuild) and is read by a real parser (Babel, scope-aware: it tells a global from a field of the
 *      same name);
 *   2  CHECK: globals, methods and syntax are allowlists. Anything else is a problem with its file and line, in
 *      the words of this file's messages. A build with problems writes nothing;
 *   3  REWRITE: a counter at the top of every loop and function, every computed key and every method call through
 *      the guard (rules/guard.ts), every text made by `+` or a template charged and capped;
 *   4  the rewritten files are linked into one module (esbuild), which is read once more and held to the same
 *      rules: no unguarded computed key and no uncounted loop or function is left in the file that is deployed.
 *
 * WHY THE CHECK READS EACH FILE BEFORE LINKING, NOT ONLY THE LINKED MODULE. The linker turns every top-level
 * `const` into `var`, so in the linked module a module-level variable the author declared could not be told from a
 * constant. Step 2 therefore reads the files one by one, and step 4 reads the deployed file again for everything else.
 *
 * WHY BABEL. The pass needs a parser that keeps up with the language, scope analysis, a code generator and source
 * maps. `@babel/parser`, `@babel/traverse`, `@babel/generator` and `@babel/types` are that, are what most of the
 * JavaScript world's own tools are built on, and are MIT-licensed. `@jridgewell/trace-mapping` (MIT) reads the
 * type-removal's source map, so a problem names the line the author wrote.
 *
 * This is a wall against a careless module written by the studio's own AI. It is not a security boundary against
 * code written to attack: no rules from outside the studio run on its server.
 */
import { parse } from '@babel/parser';
import babelTraverse from '@babel/traverse';
import * as babelGenerator from '@babel/generator';
import * as t from '@babel/types';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const traverse = babelTraverse.default ?? babelTraverse;
const generate = babelGenerator.generate ?? babelGenerator.default;

/** Where rules import Homie's side from, and where the rewritten code finds the guard. */
export const RULES_MODULE = '@homie-rocks/studio/rules';
export const GUARD_MODULE = '@homie-rocks/studio/rules/guard';
const G = '__homie';

/*
 * THE ALLOWLISTS. The method lists and the refused names are the ones rules/guard.ts enforces at run time, and
 * the maths names are rules/math.ts's (a test holds each pair equal: this file is loaded by Node from an installed
 * package, where a .ts file cannot be imported).
 */
export const MATH_FNS = ['sqrt', 'abs', 'floor', 'ceil', 'round', 'trunc', 'min', 'max', 'sign', 'imul', 'fround'];
export const ARRAY_METHODS = ['push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat', 'indexOf', 'lastIndexOf', 'includes', 'find', 'findIndex', 'some', 'every', 'map', 'filter', 'reduce', 'forEach', 'flat', 'flatMap', 'sort', 'reverse', 'join', 'at'];
export const STRING_METHODS = ['slice', 'indexOf', 'includes', 'startsWith', 'endsWith', 'split', 'trim', 'toUpperCase', 'toLowerCase', 'charCodeAt', 'at'];
export const MAPSET_METHODS = ['get', 'set', 'has', 'add', 'delete', 'clear', 'forEach', 'keys', 'values', 'entries'];
export const REFUSED_NAMES = ['constructor', 'prototype', '__proto__', 'stack', 'localeCompare'];
/** What the host runtime's own objects offer: `world`, `ctx`, the round, the map (rules/core.ts) and `world.math` (rules/math.ts). */
export const WORLD_METHODS = ['ticks', 'random', 'send', 'sendRoom', 'announce', 'sendArea', 'after', 'emit', 'spawn', 'despawn', 'place', 'near', 'inBox', 'ray', 'sweep', 'ask', 'goalDone', 'finish', 'end', 'spot', 'spots'];
export const MATH_METHODS = ['sin', 'cos', 'tan', 'atan', 'atan2', 'asin', 'acos', 'exp', 'log', 'pow', 'hypot', 'rad', 'deg', 'clamp', 'lerp', 'vec', 'add', 'sub', 'scale', 'dot', 'cross', 'len', 'dist', 'norm', 'clampLen', 'lerpVec', 'dir', 'angle'];
const VALUE_METHODS = new Set([...ARRAY_METHODS, ...STRING_METHODS, ...MAPSET_METHODS]);
const CALLABLE = new Set([...VALUE_METHODS, ...WORLD_METHODS, ...MATH_METHODS]);
const refusedName = (k) => REFUSED_NAMES.includes(k) || k.startsWith('toLocale');
const GLOBAL_MEMBERS = {
  Math: { call: MATH_FNS, read: [] },
  Number: { call: ['isFinite', 'isInteger', 'isNaN'], read: ['MAX_SAFE_INTEGER', 'EPSILON'] },
  Object: { call: ['keys', 'values', 'entries'], read: [] },
  Array: { call: ['isArray'], read: [] },
};
const GLOBAL_CALLS = ['Number', 'String', 'Boolean', 'Error'];
const GLOBAL_NEW = ['Map', 'Set', 'Error'];
const GLOBAL_VALUES = ['Infinity', 'NaN', 'undefined'];
const HOMIE_CALLS = ['defineRules', 'defineMove'];

/** What a refused global is, in a few words, with what to use instead. */
const GLOBAL_WORDS = {
  Date: 'rules have no wall clock: use world.tick and world.ticks(seconds)',
  JSON: 'rules pack nothing themselves: declared fields are packed for them',
  Promise: 'a handler finishes inside its tick: nothing in rules waits',
  setTimeout: 'use world.after(ticks, event, data)', setInterval: 'use world.after(ticks, event, data)', queueMicrotask: 'a handler finishes inside its tick',
  fetch: 'rules reach nothing outside their room', crypto: 'use world.random()', performance: 'use world.tick',
  Symbol: 'rules name things with plain strings', Proxy: 'rules hold plain data', Reflect: 'rules hold plain data', globalThis: 'rules are handed a world object and nothing else',
  eval: 'nothing in rules is made from text', Function: 'nothing in rules is made from text', console: 'rules do not log: the runtime counts what goes wrong',
  window: 'rules do not run in a page', document: 'rules do not run in a page', arguments: 'name the parameters, or use a rest parameter (...args)',
  parseInt: 'use Number(x) and Math.trunc', parseFloat: 'use Number(x)', isNaN: 'use Number.isNaN(x)', isFinite: 'use Number.isFinite(x)',
};

/** A problem as the build prints it: `games/coin-dash/src/rules.ts:14 Math.sin is not available in rules: use world.math.sin`. */
export const problemLine = (p) => `${p.file}:${p.line} ${p.message}`;

function statementsOf(path) {
  const p = path.parentPath;
  return p && (p.isBlockStatement() || p.isProgram()) ? p : null;
}
const inFunction = (path) => Boolean(path.getFunctionParent());
/** The identifier an assignment target starts from (`a.b[c].d` is `a`), or null. */
function rootOf(node) {
  let n = node;
  while (t.isMemberExpression(n) || t.isOptionalMemberExpression(n)) n = n.object;
  return t.isIdentifier(n) ? n : null;
}
/** The linker may number a second import of the guard (`__homie2`): every such name is the guard's. */
const isGuard = (node) => t.isIdentifier(node) && /^__homie\d*$/.test(node.name);
const isGuardCall = (node) => t.isCallExpression(node) && t.isMemberExpression(node.callee) && isGuard(node.callee.object);
/** Whether an expression is a number whatever runs (so `+` on it makes no text worth charging). */
function numeric(n) {
  if (t.isNumericLiteral(n)) return true;
  if (t.isUnaryExpression(n) && ['-', '+', '~'].includes(n.operator)) return true;
  if (t.isUpdateExpression(n)) return true;
  if (t.isBinaryExpression(n)) return ['-', '*', '/', '%', '&', '|', '^', '<<', '>>', '>>>'].includes(n.operator) || (n.operator === '+' && numeric(n.left) && numeric(n.right));
  if (t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.object, { name: 'Math' })) return true;
  if (t.isParenthesizedExpression(n)) return numeric(n.expression);
  return false;
}

/**
 * One file of rules, checked and (when it has no problem) rewritten.
 *   code      the file as JavaScript (types already removed)
 *   file      what a problem calls it (`games/coin-dash/src/rules.ts`)
 *   map       the type-removal's source map, so lines are the author's
 *   linked    this is the linked module (step 4): top-level `var` and the guard's own names are expected,
 *             and nothing is rewritten
 * Returns { code, problems }.
 */
export function guardSource(code, { file = 'rules.js', map = null, linked = false } = {}) {
  const problems = [];
  const tracer = map ? new TraceMap(typeof map === 'string' ? JSON.parse(map) : map) : null;
  const lineOf = (node) => {
    const at = node?.loc?.start;
    if (!at) return 0;
    if (!tracer) return at.line;
    const o = originalPositionFor(tracer, { line: at.line, column: at.column });
    return o && o.line ? o.line : at.line;
  };
  const bad = (node, message) => { if (problems.length < 60 && !problems.some((p) => p.line === lineOf(node) && p.message === message)) problems.push({ file, line: lineOf(node), message }); };
  let ast;
  try { ast = parse(code, { sourceType: 'module', sourceFilename: file }); } catch (error) {
    return { code: null, problems: [{ file, line: error?.loc?.line ?? 0, message: `this file does not parse: ${String(error?.message ?? error).split('\n')[0]}` }] };
  }
  const homie = new Set();   // names imported from Homie's rules module
  const own = new Set();     // names imported from the game's own files

  /* ------------------------------------------------------------ what the top level of a rules file may hold */
  const loadSafe = (n, top = false) => {
    if (!n) return true;
    if (t.isNumericLiteral(n) || t.isStringLiteral(n) || t.isBooleanLiteral(n) || t.isNullLiteral(n)) return true;
    if (t.isFunctionExpression(n) || t.isArrowFunctionExpression(n)) return true;
    if (t.isIdentifier(n)) return true;
    if (t.isTemplateLiteral(n)) return n.expressions.every((e) => loadSafe(e));
    if (t.isUnaryExpression(n)) return loadSafe(n.argument);
    if (t.isBinaryExpression(n) || t.isLogicalExpression(n)) return loadSafe(n.left) && loadSafe(n.right);
    if (t.isConditionalExpression(n)) return loadSafe(n.test) && loadSafe(n.consequent) && loadSafe(n.alternate);
    if (t.isParenthesizedExpression(n)) return loadSafe(n.expression);
    if (t.isArrayExpression(n)) return n.elements.every((e) => e === null || (t.isSpreadElement(e) ? loadSafe(e.argument) : loadSafe(e)));
    if (t.isObjectExpression(n)) return n.properties.every((p) => (t.isSpreadElement(p) ? loadSafe(p.argument) : t.isObjectMethod(p) ? true : loadSafe(p.value) && (!p.computed || loadSafe(p.key))));
    if (t.isMemberExpression(n)) return loadSafe(n.object) && (!n.computed || loadSafe(n.property));
    if (t.isCallExpression(n)) {
      const c = n.callee;
      const homieCall = (t.isIdentifier(c) && homie.has(c.name) && (HOMIE_CALLS.includes(c.name) || linked)) || (t.isMemberExpression(c) && !c.computed && t.isIdentifier(c.object) && homie.has(c.object.name));
      const guardCall = linked && isGuardCall(n);
      if (!homieCall && !guardCall) { bad(n, 'nothing of the game\'s runs when a rules file loads: the top level holds imports, constants made of literals, functions, and calls to defineRules, defineMove and f. Move this call into a handler'); return false; }
      return n.arguments.every((a) => (t.isSpreadElement(a) ? loadSafe(a.argument) : loadSafe(a)));
    }
    if (top) bad(n, 'a module-level constant is made of literals: numbers, texts, lists and objects of them');
    return false;
  };
  let defaultName = null;
  for (const st of ast.program.body) if (t.isExportNamedDeclaration(st) && !st.declaration) for (const sp of st.specifiers) if (t.isExportSpecifier(sp) && (sp.exported.name ?? sp.exported.value) === 'default') defaultName = sp.local.name;
  for (const st of ast.program.body) {
    if (t.isImportDeclaration(st)) {
      const from = st.source.value;
      if (from === RULES_MODULE || (linked && from === GUARD_MODULE)) { for (const s of st.specifiers) homie.add(s.local.name); continue; }
      if (/^\.\.?\//.test(from) && !linked) { for (const s of st.specifiers) own.add(s.local.name); continue; }
      bad(st, `rules import only ${RULES_MODULE} and the game's own files, not "${from}"`);
      continue;
    }
    const decl = t.isExportNamedDeclaration(st) || t.isExportDefaultDeclaration(st) ? st.declaration : st;
    if (t.isExportNamedDeclaration(st) && !st.declaration) { if (st.source) bad(st, 'rules export their own declarations, not another file\'s'); continue; }
    if (t.isFunctionDeclaration(decl)) continue;
    if (t.isVariableDeclaration(decl)) {
      // Removing types turns `export default <expression>` into a `var` that is exported as the default: that one is the module's own.
      const isDefault = decl.kind === 'var' && decl.declarations.length === 1 && t.isIdentifier(decl.declarations[0].id) && defaultName === decl.declarations[0].id.name;
      if (decl.kind !== 'const' && !isDefault && !(linked && decl.kind === 'var')) { bad(decl, `a rules module has no state of its own: "${decl.kind}" at module level is refused. Put this in a declared field (fields, motion or shared), or make it a const`); continue; }
      for (const d of decl.declarations) if (!loadSafe(d.init, true) && !problems.length) bad(d, 'a module-level constant is made of literals: numbers, texts, lists and objects of them');
      continue;
    }
    if (t.isExportDefaultDeclaration(st)) { if (!loadSafe(st.declaration, true) && !problems.length) bad(st, 'a rules module is `export default defineRules({ … })`'); continue; }
    bad(st, 'nothing of the game\'s runs when a rules file loads: the top level holds imports, constants, functions and the defineRules / defineMove calls');
  }

  /* ------------------------------------------------------------ the check */
  const moduleBinding = (path, name) => { const b = path.scope.getBinding(name); return Boolean(b && b.scope.block === ast.program); };
  const checkName = (node, name) => {
    if (typeof name !== 'string') return;
    if (refusedName(name)) bad(node, `"${name}" is a name rules may not use: it reaches the machinery under a value, not the value`);
  };
  const checkGlobal = (path) => {
    const name = path.node.name;
    const parent = path.parent;
    if (GLOBAL_VALUES.includes(name)) return;
    const asObject = (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.object === path.node;
    if (GLOBAL_MEMBERS[name]) {
      const spec = GLOBAL_MEMBERS[name];
      const prop = asObject && !parent.computed && t.isIdentifier(parent.property) ? parent.property.name : null;
      const called = prop && t.isCallExpression(path.parentPath.parent) && path.parentPath.parent.callee === parent;
      if (prop && spec.read.includes(prop) && !called) return;
      if (prop && spec.call.includes(prop) && called) return;
      if (name === 'Number' && t.isCallExpression(parent) && parent.callee === path.node) return;
      if (name === 'Math' && prop && MATH_METHODS.includes(prop)) return bad(parent, `Math.${prop} is not available in rules, because browsers and servers may disagree on its last digits: use world.math.${prop} (ctx.math.${prop} in move.ts)`);
      if (prop && spec.call.includes(prop)) return bad(parent, `${name}.${prop} may be called, never read as a value`);
      return bad(parent, `${name}${prop ? `.${prop}` : ''} is not available in rules (${name} offers ${[...spec.call, ...spec.read].join(', ')})`);
    }
    if (t.isCallExpression(parent) && parent.callee === path.node && GLOBAL_CALLS.includes(name)) return;
    if (t.isNewExpression(parent) && parent.callee === path.node && GLOBAL_NEW.includes(name)) {
      if (name !== 'Error' && !inFunction(path)) bad(parent, `a ${name} is made inside a handler only: a rules module has no state of its own`);
      return;
    }
    if (GLOBAL_CALLS.includes(name) || GLOBAL_NEW.includes(name)) return bad(path.node, `${name} is used in rules only as ${GLOBAL_NEW.includes(name) ? `new ${name}(…)` : `${name}(x)`}`);
    bad(path.node, `${name} is not available in rules${GLOBAL_WORDS[name] ? `: ${GLOBAL_WORDS[name]}` : ''}`);
  };
  const checkWrite = (path, target) => {
    if (t.isObjectPattern(target) || t.isArrayPattern(target)) return;
    const root = rootOf(target);
    if (!root) return;
    if (!path.scope.getBinding(root.name)) return bad(target, `${root.name} is not the game's to change`);
    if (moduleBinding(path, root.name) && !linked) bad(target, `a rules module has no state of its own: "${root.name}" is declared at module level, so nothing may assign to it or to anything in it. Put what changes in a declared field`);
    if ((t.isMemberExpression(target) && !target.computed && t.isIdentifier(target.property, { name: 'length' }))) bad(target, 'a list\'s length is not set by hand: use push, pop or splice');
  };
  const chainTop = (path) => !(path.parentPath.isOptionalMemberExpression() || path.parentPath.isOptionalCallExpression()) || (path.parent.object !== path.node && path.parent.callee !== path.node);
  const refuseSyntax = {
    ImportExpression: 'import() is refused: rules are one module, loaded once',
    MetaProperty: 'import.meta and new.target are refused in rules',
    AwaitExpression: 'await is refused: a handler finishes inside its tick',
    YieldExpression: 'generators are refused: a handler finishes inside its tick',
    ClassDeclaration: 'class is refused in rules: state is declared fields, behaviour is handlers',
    ClassExpression: 'class is refused in rules: state is declared fields, behaviour is handlers',
    ThisExpression: '`this` is refused in rules: a handler is handed world and self',
    TryStatement: 'try, catch and finally are refused in rules: the runtime catches what a handler throws',
    RegExpLiteral: 'regular expressions are refused in rules: use the text methods (includes, startsWith, split…)',
    WithStatement: '`with` is refused in rules',
    TaggedTemplateExpression: 'tagged templates are refused in rules',
    DebuggerStatement: '`debugger` is refused in rules',
    Super: '`super` is refused in rules',
  };
  const member = (path) => {
      const n = path.node;
      if (!n.computed) checkName(n, n.property.name);
      else if (t.isStringLiteral(n.property)) checkName(n, n.property.value);
      if (linked && n.computed && !t.isNumericLiteral(n.property)) bad(n, 'the linked module holds a computed key the guard did not rewrite');
      if (path.isOptionalMemberExpression() && !chainTop(path) && (n.computed || VALUE_METHODS.has(n.property.name)) && !linked) bad(n, 'this optional chain is too long for the guard to follow: take the first step into a const, then go on from it');
  };
  const visitor = {};
  for (const [type, message] of Object.entries(refuseSyntax)) visitor[type] = (path) => bad(path.node, message);
  Object.assign(visitor, {
    Function(path) {
      if (path.node.async) bad(path.node, 'async is refused: a handler finishes inside its tick');
      if (path.node.generator) bad(path.node, 'generators are refused: a handler finishes inside its tick');
    },
    ObjectMethod(path) { if (path.node.kind !== 'method') bad(path.node, 'getters and setters are refused in rules'); checkName(path.node, !path.node.computed && (path.node.key.name ?? path.node.key.value)); },
    ForOfStatement(path) { if (path.node.await) bad(path.node, 'await is refused: a handler finishes inside its tick'); if (!t.isVariableDeclaration(path.node.left)) checkWrite(path, path.node.left); },
    ForInStatement(path) { if (!t.isVariableDeclaration(path.node.left)) checkWrite(path, path.node.left); },
    BinaryExpression(path) { if (path.node.operator === '**') bad(path.node, 'the ** operator is refused, because browsers and servers may disagree on its last digits: use world.math.pow (ctx.math.pow in move.ts)'); },
    UnaryExpression(path) { if (path.node.operator === 'delete') bad(path.node, 'delete is refused in rules: a declared map drops a key when its value is set through the map\'s own field'); },
    AssignmentExpression(path) {
      if (path.node.operator === '**=') bad(path.node, 'the **= operator is refused: use world.math.pow');
      checkWrite(path, path.node.left);
    },
    UpdateExpression(path) { checkWrite(path, path.node.argument); },
    Identifier(path) {
      const name = path.node.name;
      if (name.startsWith(G) && !linked) return bad(path.node, `names beginning ${G} are the runtime's own`);
      if (!path.isReferencedIdentifier()) return;
      if (name === 'arguments' || !path.scope.getBinding(name)) { if (!(linked && isGuard(path.node))) checkGlobal(path); }
    },
    MemberExpression(path) { member(path); },
    OptionalMemberExpression(path) { member(path); },
    'ObjectProperty'(path) {
      const n = path.node;
      if (!n.computed) checkName(n, n.key.name ?? n.key.value);
    },
    CallExpression(path) {
      const c = path.node.callee;
      if (!t.isMemberExpression(c) || c.computed || linked) return;
      const name = c.property.name;
      const obj = c.object;
      if (t.isIdentifier(obj) && !path.scope.getBinding(obj.name)) return;   // a global: checkGlobal has it
      if (t.isIdentifier(obj) && homie.has(obj.name) && !inFunction(path)) return;   // f.u16() at the top level
      if (!CALLABLE.has(name) && !refusedName(name)) bad(path.node, `"${name}" is not a method rules may call. On a list: ${ARRAY_METHODS.slice(0, 8).join(', ')}…; on a text: ${STRING_METHODS.slice(0, 5).join(', ')}…; on a Map or Set: ${MAPSET_METHODS.slice(0, 5).join(', ')}…; and what world, ctx and world.math offer`);
    },
    OptionalCallExpression(path) {
      const c = path.node.callee;
      if (linked || t.isIdentifier(c)) return;
      if (!(t.isOptionalMemberExpression(c) && !c.computed && c.optional && !path.node.optional && chainTop(path))) return bad(path.node, 'this optional call is too involved for the guard to follow: test for the value first, then call');
      if (!CALLABLE.has(c.property.name)) bad(path.node, `"${c.property.name}" is not a method rules may call`);
    },
    NewExpression(path) {
      const c = path.node.callee;
      if (!(t.isIdentifier(c) && GLOBAL_NEW.includes(c.name) && !path.scope.getBinding(c.name))) bad(path.node, 'rules make new values only with new Map(), new Set() and new Error(message)');
    },
    ObjectPattern(path) {
      if (linked) return;
      // A pattern may not take a method out of a value. In a declaration the guard checks each such name once it is bound.
      const decl = path.parentPath.isVariableDeclarator() && path.parentPath.parentPath.isVariableDeclaration() && statementsOf(path.parentPath.parentPath);
      for (const p of path.node.properties) {
        if (t.isRestElement(p)) continue;
        const risky = p.computed || VALUE_METHODS.has(p.key.name ?? p.key.value);
        if (risky && !(decl && t.isIdentifier(p.value))) bad(p, `take "${p.computed ? 'a computed key' : p.key.name ?? p.key.value}" out with a plain \`const { … } = value\` declaration, or read it with a dot: a pattern here could take a method out of a value`);
      }
    },
  });
  traverse(ast, visitor);
  if (problems.length || linked) {
    if (linked && !problems.length) verifyLinked(ast, bad);
    return { code: linked && !problems.length ? code : null, problems };
  }

  /* ------------------------------------------------------------ the rewrite */
  const line = (node) => t.numericLiteral(lineOf(node));
  const call = (fn, args) => { const c = t.callExpression(t.memberExpression(t.identifier(G), t.identifier(fn)), args); c._homie = true; return c; };
  const counted = () => t.expressionStatement(call('t', []));
  const block = (path, key) => {
    const body = path.node[key];
    if (!t.isBlockStatement(body)) path.node[key] = t.blockStatement(t.isExpression(body) ? [t.returnStatement(body)] : [body]);
    path.node[key].body.unshift(counted());
  };
  const args = (list) => t.arrayExpression(list.map((a) => (t.isSpreadElement(a) ? t.spreadElement(call('sp', [a.argument, line(a)])) : a)));
  const isTarget = (path) => (path.parentPath.isAssignmentExpression() && path.parent.left === path.node) || (path.parentPath.isUpdateExpression()) || (path.parentPath.isForXStatement() && path.parent.left === path.node)
    || path.parentPath.isArrayPattern() || (path.parentPath.isObjectProperty() && path.parentPath.parentPath.isObjectPattern()) || path.parentPath.isRestElement() || (path.parentPath.isAssignmentPattern() && path.parent.left === path.node);
  const globalObject = (path, obj) => t.isIdentifier(obj) && !path.scope.getBinding(obj.name);
  const frozen = new Set();
  const computedKey = (path) => { if (path.node.computed && !t.isNumericLiteral(path.node.key) && !isGuardCall(path.node.key)) path.node.key = call('k', [path.node.key, line(path.node)]); };
  traverse(ast, {
    Loop(path) { block(path, 'body'); },
    Function(path) { if (!path.node._homie) block(path, 'body'); },
    VariableDeclaration: {
      exit(path) {
        const list = statementsOf(path);
        // Module-level constants are frozen all the way down at load.
        if (path.parentPath.isProgram() || (path.parentPath.isExportNamedDeclaration() && path.parentPath.parentPath.isProgram())) {
          for (const d of path.node.declarations) if ((t.isArrayExpression(d.init) || t.isObjectExpression(d.init)) && !frozen.has(d)) { frozen.add(d); d.init = call('deepFreeze', [d.init]); }
          return;
        }
        if (!list) return;
        const checks = [];
        for (const d of path.node.declarations) {
          if (!t.isObjectPattern(d.id)) continue;
          for (const p of d.id.properties) if (!t.isRestElement(p) && t.isIdentifier(p.value) && (p.computed || VALUE_METHODS.has(p.key.name ?? p.key.value))) checks.push(t.expressionStatement(call('nf', [t.identifier(p.value.name), line(p)])));
        }
        if (checks.length) path.insertAfter(checks);
      },
    },
    ObjectProperty: { exit(path) { computedKey(path); } },
    ObjectMethod: { exit(path) { computedKey(path); } },
    SpreadElement: {
      exit(path) { if (path.parentPath.isObjectExpression() && !isGuardCall(path.node.argument)) path.node.argument = call('sp', [path.node.argument, line(path.node)]); },
    },
    ArrayExpression: {
      exit(path) {
        if (path.node._homie || !path.node.elements.some((e) => t.isSpreadElement(e))) return;
        const a = args(path.node.elements.filter((e) => e !== null));
        a._homie = true;
        path.replaceWith(call('lit', [a, line(path.node)]));
        path.skip();
      },
    },
    TemplateLiteral: {
      exit(path) { if (!path.node.expressions.length || path.node._homie || path.parentPath.isTaggedTemplateExpression()) return; path.node._homie = true; path.replaceWith(call('tpl', [path.node, line(path.node)])); path.skip(); },
    },
    BinaryExpression: {
      exit(path) {
        const n = path.node;
        if (n.operator !== '+' || numeric(n.left) || numeric(n.right)) return;
        path.replaceWith(call('add', [n.left, n.right, line(n)]));
        path.skip();
      },
    },
    NewExpression: {
      exit(path) {
        const name = path.node.callee.name;
        if (name !== 'Map' && name !== 'Set') return;
        path.replaceWith(call(name === 'Map' ? 'map' : 'set', path.node.arguments));
        path.skip();
      },
    },
    AssignmentExpression: {
      exit(path) {
        const n = path.node;
        const left = n.left;
        if (t.isMemberExpression(left) && left.computed && !t.isNumericLiteral(left.property)) {
          if (n.operator === '=') { path.replaceWith(call('s', [left.object, left.property, n.right, line(n)])); path.skip(); return; }
          const old = t.identifier(`${G}V`);
          const op = n.operator.slice(0, -1);
          const next = ['||', '&&', '??'].includes(op) ? t.logicalExpression(op, old, n.right) : op === '+' && !numeric(n.right) ? call('add', [old, n.right, line(n)]) : t.binaryExpression(op, old, n.right);
          const fn = t.arrowFunctionExpression([t.identifier(`${G}V`)], next);
          fn._homie = true;
          path.replaceWith(call('u', [left.object, left.property, fn, t.booleanLiteral(false), line(n)]));
          path.skip();
          return;
        }
        // `x += text`: the text made is charged and capped. The target is read twice, so it must be a plain name or a dotted one.
        if (n.operator === '+=' && !numeric(n.right)) {
          const plainTarget = (x) => t.isIdentifier(x) || (t.isMemberExpression(x) && !x.computed && plainTarget(x.object));
          if (plainTarget(left)) { path.replaceWith(t.assignmentExpression('=', left, call('add', [t.cloneNode(left), n.right, line(n)]))); path.skip(); }
        }
      },
    },
    UpdateExpression: {
      exit(path) {
        const a = path.node.argument;
        if (!(t.isMemberExpression(a) && a.computed && !t.isNumericLiteral(a.property))) return;
        const fn = t.arrowFunctionExpression([t.identifier(`${G}V`)], t.binaryExpression(path.node.operator === '++' ? '+' : '-', t.identifier(`${G}V`), t.numericLiteral(1)));
        fn._homie = true;
        path.replaceWith(call('u', [a.object, a.property, fn, t.booleanLiteral(!path.node.prefix), line(path.node)]));
        path.skip();
      },
    },
    CallExpression: {
      exit(path) {
        const n = path.node;
        if (n._homie || isGuardCall(n)) return;
        const c = n.callee;
        if (t.isMemberExpression(c)) {
          if (!c.computed && globalObject(path, c.object)) {
            if (c.object.name === 'Object') { path.replaceWith(call(c.property.name, n.arguments)); path.skip(); }
            return;
          }
          if (!inFunction(path)) return;   // f.u16() and friends, at the top level
          path.replaceWith(c.computed ? call('cc', [c.object, c.property, args(n.arguments), line(n)]) : call('c', [c.object, t.stringLiteral(c.property.name), args(n.arguments), line(n)]));
          path.skip();
          return;
        }
        for (let i = 0; i < n.arguments.length; i += 1) { const a = n.arguments[i]; if (t.isSpreadElement(a) && !isGuardCall(a.argument)) a.argument = call('sp', [a.argument, line(a)]); }
      },
    },
    OptionalCallExpression: {
      exit(path) {
        const c = path.node.callee;
        if (!t.isOptionalMemberExpression(c)) return;
        path.replaceWith(call('co', [c.object, t.stringLiteral(c.property.name), args(path.node.arguments), line(path.node)]));
        path.skip();
      },
    },
    MemberExpression: {
      exit(path) {
        const n = path.node;
        if (isGuard(n.object)) return;
        if ((path.parentPath.isCallExpression() || path.parentPath.isOptionalCallExpression()) && path.parent.callee === n) return;
        if (isTarget(path)) { if (n.computed && !t.isNumericLiteral(n.property) && !(path.parentPath.isAssignmentExpression() || path.parentPath.isUpdateExpression())) bad(n, 'assign to a computed key with a plain `a[k] = value`, not inside a pattern'); return; }
        if (n.computed) { if (t.isNumericLiteral(n.property)) return; path.replaceWith(call('g', [n.object, n.property, line(n)])); path.skip(); return; }
        if (VALUE_METHODS.has(n.property.name) && !globalObject(path, n.object)) { path.replaceWith(call('rd', [n.object, t.stringLiteral(n.property.name), line(n)])); path.skip(); }
      },
    },
    OptionalMemberExpression: {
      exit(path) {
        const n = path.node;
        if (path.parentPath.isOptionalCallExpression() && path.parent.callee === n) return;
        if (n.computed) { if (t.isNumericLiteral(n.property)) return; path.replaceWith(call('go', [n.object, n.property, line(n)])); path.skip(); return; }
        if (VALUE_METHODS.has(n.property.name)) { path.replaceWith(call('rdo', [n.object, t.stringLiteral(n.property.name), line(n)])); path.skip(); }
      },
    },
  });
  if (problems.length) return { code: null, problems };
  ast.program.body.unshift(t.importDeclaration([t.importNamespaceSpecifier(t.identifier(G))], t.stringLiteral(GUARD_MODULE)));
  return { code: generate(ast, { comments: false }).code, problems: [] };
}

/** Step 4: the deployed file holds no loop or function the guard did not count. (Computed keys are checked while it is read.) */
function verifyLinked(ast, bad) {
  const counts = (body) => {
    const first = t.isBlockStatement(body) ? body.body[0] : null;
    return Boolean(first && t.isExpressionStatement(first) && isGuardCall(first.expression) && first.expression.callee.property.name === 't');
  };
  traverse(ast, {
    Loop(path) { if (!counts(path.node.body)) bad(path.node, 'the linked module holds a loop the guard did not count'); },
    Function(path) {
      const own = path.node.params.length === 1 && t.isIdentifier(path.node.params[0]) && path.node.params[0].name.startsWith(G);
      if (!own && !counts(path.node.body)) bad(path.node, 'the linked module holds a function the guard did not count');
    },
  });
}

/* ---------------------------------------------------------------- a game's rules, from its files to one module */

const exts = ['', '.ts', '.js', '.mjs'];
function resolveOwn(from, spec) {
  const base = resolve(dirname(from), spec);
  for (const e of exts) if (existsSync(base + e) && statSync(base + e).isFile()) return base + e;
  return null;
}

/**
 * Every file a game's rules are made of, each with its types removed, checked and rewritten.
 *   entry   games/<id>/src/rules.ts (or move.ts, for a view's bundle)
 * Returns { files: Map<absolute path, guarded code>, problems }. With problems, nothing is to be written.
 */
export async function guardFiles(esbuild, root, gameDir, entry) {
  const files = new Map();
  const problems = [];
  const todo = [entry];
  while (todo.length) {
    const file = todo.pop();
    if (files.has(file)) continue;
    const shown = relative(root, file).split('\\').join('/');
    if (relative(gameDir, file).startsWith('..')) { problems.push({ file: shown, line: 0, message: 'rules import only files of their own game' }); files.set(file, null); continue; }
    let stripped;
    try { stripped = await esbuild.transform(readFileSync(file, 'utf8'), { loader: /\.ts$/.test(file) ? 'ts' : 'js', format: 'esm', target: 'es2022', sourcemap: 'external', sourcefile: shown }); } catch (error) {
      const first = error.errors?.[0];
      problems.push({ file: shown, line: first?.location?.line ?? 0, message: `this file does not parse: ${first?.text ?? error.message}` }); files.set(file, null); continue;
    }
    const res = guardSource(stripped.code, { file: shown, map: stripped.map });
    problems.push(...res.problems);
    files.set(file, res.code);
    for (const m of stripped.code.matchAll(/^\s*import\s[^'"]*['"](\.\.?\/[^'"]+)['"]/gm)) {
      const next = resolveOwn(file, m[1]);
      if (next) todo.push(next); else problems.push({ file: shown, line: 0, message: `"${m[1]}" is not a file of this game` });
    }
  }
  return { files, problems };
}

/** An esbuild plugin that serves a game's guarded files in place of its sources (`stub`: files a bundle must not hold at all). */
export function guardedPlugin(files, { stub = [] } = {}) {
  return {
    name: 'homie-rules-guard',
    setup(b) {
      b.onLoad({ filter: /\.(?:ts|js|mjs)$/ }, (a) => {
        if (stub.includes(a.path)) return { contents: 'export default {};\n', loader: 'js' };
        const code = files.get(a.path);
        return typeof code === 'string' ? { contents: code, loader: 'js' } : null;
      });
    },
  };
}

/**
 * A game's rules as the one module the Worker loads: guarded, linked, and read once more as linked.
 * Returns { ok, code, problems, files }. `code` imports only Homie's rules module and the guard.
 */
export async function guardRules(esbuild, root, gameDir, { entry = join(gameDir, 'src', 'rules.ts') } = {}) {
  const { files, problems } = await guardFiles(esbuild, root, gameDir, entry);
  if (problems.length) return { ok: false, code: null, problems, files };
  let linked;
  try {
    linked = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', write: false, absWorkingDir: root, logLevel: 'silent', external: [RULES_MODULE, GUARD_MODULE], plugins: [guardedPlugin(files)], legalComments: 'none' });
  } catch (error) {
    const first = error.errors?.[0];
    return { ok: false, code: null, files, problems: [{ file: first?.location?.file ?? relative(root, entry), line: first?.location?.line ?? 0, message: `the rules did not link: ${first?.text ?? error.message}` }] };
  }
  const code = linked.outputFiles[0].text;
  const again = guardSource(code, { file: `${relative(root, gameDir).split('\\').join('/')} (linked rules)`, linked: true });
  return { ok: !again.problems.length, code: again.problems.length ? null : code, problems: again.problems, files };
}
