import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// CRATES: touch a crate to open it, touch it again to empty it. The room keeps a ledger keyed by the
// crate's id. A crate always reports "opened" before it reports "emptied", so the ledger entry exists.
export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: { ledger: f.map(f.u8(), 16), haul: f.u32(), opens: f.u32() },
  shapes: {
    events: { touch: { by: f.ref() }, opened: { crate: f.ref() }, emptied: { crate: f.ref(), by: f.ref() }, loot: { value: f.u8() }, shut: {} },
    commands: {},
    effects: { pop: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), nextTouch: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      think(world, self) {
        const crate = world.near(self.pos, 40, 'crate').find((c) => c.state !== 2);
        if (!crate) return { ax: 0, ay: 0 };
        const step = world.math.clampLen(world.math.sub(crate.pos, self.pos), 1);
        return { ax: Math.round(step.x * 127), ay: Math.round(step.y * 127) };
      },
      tick(world, self) {
        if (world.round.phase !== 'live' || world.tick < self.nextTouch) return;
        const crate = world.near(self.pos, 1.2, 'crate').find((c) => c.state !== 2);
        if (!crate) return;
        self.nextTouch = world.tick + world.ticks(0.5);
        world.send(crate.id, 'touch', { by: self.id });
      },
      on: { loot(world, self, e) { self.score = Math.min(65535, self.score + e.value); } },
      onRoom: { roundStart(world, self) { self.score = 0; } },
    },
    crate: {
      // state: 0 closed, 1 open, 2 empty
      fields: { state: f.u8() },
      on: {
        touch(world, self, e) {
          if (self.state === 0) {
            self.state = 1;
            world.sendRoom('opened', { crate: self.id });
            world.emit('pop', self.pos);
          } else if (self.state === 1) {
            self.state = 2;
            world.send(e.by, 'loot', { value: 3 });
            world.sendRoom('emptied', { crate: self.id, by: e.by });
            world.after(world.ticks(4), 'shut', {});
          }
        },
        shut(world, self) { self.state = 0; },
      },
    },
  },
  room: {
    rounds: { seconds: 40, breakSeconds: 3 }, bots: { keep: 3 },
    start(world) { for (const at of world.map.spots('coins')) world.spawn('crate', at); },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) { world.shared.ledger = {}; },
      opened(world, e) { world.shared.ledger[e.crate] = 1; world.shared.opens += 1; },
      // Only a crate that reported "opened" reports "emptied", in that order, so the entry is there.
      emptied(world, e) {
        world.shared.ledger[e.crate] = world.shared.ledger[e.crate] - 1;
        world.shared.haul += 3;
      },
    },
  },
});
