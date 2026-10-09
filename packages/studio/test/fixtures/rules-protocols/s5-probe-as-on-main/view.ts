import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
const room = openRoom<typeof rules>();
const log: unknown[] = [];
(window as any).__probe = { room, log };
room.on('say', (e: unknown) => log.push(['say', e]));
room.on('goal', (e: unknown) => log.push(['goal', e]));
room.on('ask', (e: unknown) => log.push(['ask', e]));
const el = document.createElement('pre'); document.body.appendChild(el);
setInterval(() => {
  const ents: unknown[] = [];
  room.each('pawn', (e: any) => ents.push({ id: e.id, seat: e.seat, driver: e.driver, x: e.pos.x, goal: e.goal ?? null, buttons: room.askButtons(e.id) }));
  (window as any).__probe.ents = ents;
  el.textContent = JSON.stringify({ status: room.status, seat: room.seat, roster: room.roster, ents, log: log.slice(-4) }, null, 1);
}, 250);
room.probe({});
