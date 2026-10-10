/** Shared browser-rules fixture. Historical imports retain their path while
 * their builds exercise the single rules-plus-view authoring contract. */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export function browserRulesGame(root, id, name = id) {
  const dir = join(root, 'games', id);
  cpSync(fileURLToPath(new URL('../starters/coin-dash/', import.meta.url)), dir, { recursive: true });
  const file = join(dir, 'game.json'), meta = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...meta, id, name, netplay: {}, entry: 'src/main.ts', room: { host: 'browser' } }, null, 2) + '\n');
  writeFileSync(join(dir, 'src/main.ts'), readFileSync(join(dir, 'src/view.ts'), 'utf8').replaceAll('coin-dash', id));
  return dir;
}

/** Minimal declared room for tests of views, assets, parts or the lab. */
export function declareRoom(dir) {
  mkdirSync(join(dir, 'map'), {recursive:true});
  writeFileSync(join(dir, 'map/main.json'), JSON.stringify({bounds:{min:[-12,-12],max:[12,12]},boxes:[],spots:{start:[[0,0]]}}));
  writeFileSync(join(dir, 'src/rules.ts'), `import {defineRules} from '@homie-rocks/studio/rules';
import {move} from './move';
export default defineRules({contract:2,space:{dims:2},move,entities:{player:{player:true,body:{shape:'circle',radius:.4,maxSpeed:1}}},room:{rounds:{seconds:2,breakSeconds:1},join(){return {kind:'player',at:{x:0,y:0,z:0}};}}});\n`);
  writeFileSync(join(dir, 'src/move.ts'), `import {defineMove} from '@homie-rocks/studio/rules';export const move=defineMove({player(){}});\n`);
}
