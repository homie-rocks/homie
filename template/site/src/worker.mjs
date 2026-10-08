// This studio's site: pages, public rooms (Table + Lobby Durable Objects), D1, and R2 once storage is added.
// The code is @homie-rocks/studio's, pinned in package.json, so an update never changes a published game by surprise.
import { hostRules } from '@homie-rocks/studio/worker';
// The rules of this studio's games that run on the server (written by homie-studio build; empty until a game has some).
import rules from './rules/index.mjs';

hostRules(rules);
export { default, Table, Lobby } from '@homie-rocks/studio/worker';
