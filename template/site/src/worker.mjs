// This studio's site: pages, public rooms (Table + Lobby Durable Objects), D1, and R2 once storage is added.
// The code is @homie-rocks/studio's, pinned in package.json, so an update never changes a published game by surprise.
import { hostRules, useTools } from '@homie-rocks/studio/worker';
// The rules of this studio's games that run on the server (written by homie-studio build; empty until a game has some).
import rules from './rules/index.mjs';

hostRules(rules);
useTools(async () => (await import('./tools/index.mjs')).default);
export { default, Table, Lobby, Gate, Concentrator } from '@homie-rocks/studio/worker';
