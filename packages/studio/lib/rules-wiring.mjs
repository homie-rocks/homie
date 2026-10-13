import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { RULES_WIRING_MESSAGE } from '../worker/rules-wiring.mjs';

/** Check executable module statements, never a comment or a function nobody calls. */
export function registersRules(text) {
  const body = parse(text, { sourceType: 'module' }).program.body;
  const hosts = new Set(), tables = new Set();
  for (const node of body) if (node.type === 'ImportDeclaration') {
    for (const s of node.specifiers) {
      if (/^@homie-rocks\/studio\/worker(?:\/selling)?$/.test(node.source.value) && s.imported?.name === 'hostRules') hosts.add(s.local.name);
      if (node.source.value === './rules/index.mjs' && s.type === 'ImportDefaultSpecifier') tables.add(s.local.name);
    }
  }
  return body.some(n => n.type === 'ExpressionStatement' && n.expression.type === 'CallExpression' && hosts.has(n.expression.callee.name) && tables.has(n.expression.arguments[0]?.name));
}

export async function ensureRulesWiring(root) {
  const file = join(root, 'site/src/worker.mjs');
  let text;
  try { text = readFileSync(file, 'utf8'); } catch { throw new Error(RULES_WIRING_MESSAGE); }
  if (registersRules(text)) return;
  // Upgrade already knows every exact generated Worker fingerprint. Reuse that
  // ownership check; a comment claiming to be generated is not ownership.
  const { upgradePlan } = await import('./upgrade.mjs');
  const update = upgradePlan(root).changes?.find(c => c.file === 'site/src/worker.mjs' && c.kind === 'update-file');
  if (update && registersRules(update.text)) { writeFileSync(file, update.text); return; }
  throw new Error(RULES_WIRING_MESSAGE);
}
