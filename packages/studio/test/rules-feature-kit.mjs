export const vocab = { v: 1, persona: 'A helpful guide.', goals: { visit: { about: 'Visit a place', args: { place: 'view.places' } }, guard: { about: 'Stay here' }, follow: { about: 'Stay with a player', args: { seat: 'player' } } }, lines: { hello: { text: 'Hello!' } }, asks: { visit: { text: 'Visit {place}', goal: 'visit', args: { place: 'view.places' } }, follow: { text: 'Follow me', goal: 'follow', args: { seat: 'player' } } } };
export const source = `
import { defineRules, defineMove, f } from '@homie-rocks/studio/rules';
export default defineRules({ contract: 2, space: { dims: 2 },
  move: defineMove({ pawn(body, input) { body.pos = { x: body.pos.x + input.ax / 100, y: 0, z: 0 }; } }),
  shapes: { view: { nearby: f.u8(), places: f.list(f.text(8), 2) }, commands: { done: {}, ask: {} } },
  shared: { answers: f.u16(), yes: f.bit() },
  asks: { director: { state: { danger: f.u8() }, questions: { advance: { type: 'noul', instructions: 'Advance?' } }, floor(state) { return { advance: state.danger < 2 }; } } },
  entities: { pawn: { player: { away: 'think', leave: 'bot' },
    fields: { floors: f.u16(), views: f.u16(), guided: f.bit(), answered: f.u16(), level: f.u8() },
    input: { ax: f.i8() }, body: { shape: 'circle', radius: 0.2, maxSpeed: 100 },
    guide: { view(world, self) { return { nearby: 7, places: ['camp'] }; }, floor(world, self, v) { self.floors += 1; const ask = v.asks[0]; return ask ? { goal: 'follow', args: ask.args } : { goal: 'guard', say: 'hello' }; } },
    think(world, self) { self.guided = self.goal !== null; return { ax: self.goal ? 50 : 0 }; },
    tick(world, self) { self.level = world.level; },
    commands: { done(world, self) { world.goalDone(true); }, ask(world, self) { world.ask('director', { danger: 1 }); } },
    on: { answer(world, self, e) { self.answered += 1; } },
  } },
  room: { bots: { keep: 2 }, rounds: { seconds: 3, breakSeconds: 1 },
    join() { return { kind: 'pawn', at: { x: 0, y: 0, z: 0 } }; },
    start(world) { world.ask('director', { danger: 1 }); },
    on: { answer(world, e) { world.shared.answers += 1; world.shared.yes = e.picks.advance; } },
  },
});`;
