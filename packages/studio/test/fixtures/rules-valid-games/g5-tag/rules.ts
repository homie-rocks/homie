// TAG: one runner is "it". Touch somebody to pass it on. You score for every second you are not it.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: {
      tagged: { by: f.ref() },
      youAreIt: { id: f.ref() },
      itIs: { id: f.ref(), seat: f.u8() },
      pickIt: {},
    },
    commands: {},
    effects: { tag: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), isIt: f.bit(), safeUntil: f.tick(), passedTo: f.ref() },
      motion: { frozenUntil: f.tick(), fast: f.bit() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if (!self.isIt) {
          if (world.tick % world.ticks(1) === 0) self.score += 1;
          return;
        }
        if (world.tick < self.motion.frozenUntil) return;
        const prey = world.near(self.pos, 1.2, 'runner').find((r) => r.id !== self.id && !r.isIt && world.tick >= r.safeUntil);
        if (!prey) return;
        // It is passed on by an event: the other runner changes its own state, on the next tick.
        self.isIt = false;
        self.motion.fast = false;
        self.safeUntil = world.tick + world.ticks(2);
        self.passedTo = prey.id;
        world.send(prey.id, 'tagged', { by: self.id });
        world.emit('tag', self.pos, {});
      },
      think(world, self) {
        const others = world.near(self.pos, 64, 'runner').filter((r) => r.id !== self.id);
        const target = self.isIt ? others.find((r) => !r.isIt) : others.find((r) => r.isIt);
        if (!target) return { ax: 0, ay: 0 };
        const d = world.math.norm(world.math.sub(target.pos, self.pos));
        const sign = self.isIt ? 1 : -1;      // chase, or run away
        return { ax: Math.round(d.x * 127 * sign), ay: Math.round(d.y * 127 * sign) };
      },
      on: {
        tagged(world, self) {
          self.isIt = true;
          self.motion.fast = true;
          self.motion.frozenUntil = world.tick + world.ticks(1);      // count to one before chasing
          world.sendRoom('itIs', { id: self.id, seat: self.seat });
        },
        undeliverable(world, self, e) {
          // The runner I tagged left before the tag landed: I am still it.
          if (e.event !== 'tagged') return;
          self.isIt = true;
          self.motion.fast = true;
          self.passedTo = '';
        },
        arrive(world, self) {
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
        leave(world, self) {
          if (self.isIt) world.sendRoom('pickIt', {});
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.isIt = false;
          self.safeUntil = 0;
          self.passedTo = '';
          self.motion.fast = false;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        youAreIt(world, self, e) {
          if (e.id !== self.id) return;
          self.isIt = true;
          self.motion.fast = true;
          self.motion.frozenUntil = world.tick + world.ticks(1.5);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },
      },
    },
  },
  shared: { it: f.ref(), itSeat: f.u8(), bodies: f.map(f.ref(), 32) },
  room: {
    rounds: { seconds: 8, breakSeconds: 2 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      seatJoined(world, e) { world.shared.bodies = { ...world.shared.bodies, [String(e.seat)]: e.id }; },
      seatLeft(world, e) {
        const next: Record<string, string> = {};
        for (const [seat, id] of Object.entries(world.shared.bodies)) if (seat !== String(e.seat)) next[seat] = id;
        world.shared.bodies = next;
        if (world.shared.it === e.id) world.sendRoom('pickIt', {});
      },
      roundStart(world) { world.sendRoom('pickIt', {}); },
      pickIt(world) {
        const seats = Object.keys(world.shared.bodies).sort();
        if (seats.length === 0) return;
        const seat = seats[Math.floor(world.random() * seats.length)];
        world.shared.it = world.shared.bodies[seat];
        world.shared.itSeat = Number(seat);
        world.announce('youAreIt', { id: world.shared.it });
      },
      itIs(world, e) { world.shared.it = e.id; world.shared.itSeat = e.seat; },
    },
  },
  map: './map',
});
