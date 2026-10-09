/*
 * COIN DASH — the rules: the example of a game whose rules run on the server.
 *
 * What is true in the game is decided here, in one place, on the studio's own Cloudflare: who took which coin, every
 * score, when a round starts and ends. A player's browser sends what the player presses and draws what it is told
 * (src/view.ts); it cannot change a score.
 *
 * HOW RULES ARE WRITTEN. Every entity owns its own state, in declared fields. A handler may write only the entity it
 * runs for (`self`); everything else it reads is read-only. To affect another entity it sends an event, which arrives
 * on a later tick. So a runner does not take a coin: it asks the coin (`take`), the coin answers the first one that
 * asked (`score`) and is gone, and a second `take` finds nobody there.
 *
 * The server moves every runner with src/move.ts. The view predicts its own runner using that same module,
 * so controls answer immediately while the server decides what is true.
 */
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

export default defineRules({
  contract: 2,
  space: { dims: 2 },
  move,
  shapes: {
    events: { take: { by: f.ref() }, score: {} },
    commands: {},
    effects: { ding: {} },
  },
  entities: {
    runner: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }) },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6 },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        // A second `take` sent before the coin is gone is dropped: the coin no longer exists.
        for (const coin of world.near(self.pos, 1, 'coin')) world.send(coin.id, 'take', { by: self.id });
      },
      think(world, self) {                 // a bot, and a player who is away
        const coin = world.near(self.pos, 64, 'coin')[0];
        if (!coin) return { ax: 0, ay: 0 };
        const d = world.math.norm(world.math.sub(coin.pos, self.pos));
        return { ax: Math.round(d.x * 127), ay: Math.round(d.y * 127) };
      },
      on: {
        score(world, self) { self.score += 1; },
        arrive(world, self) {              // joined during a break: stand still with the others
          if (world.round.phase === 'over') self.motion.frozenUntil = world.round.endsAt;
        },
      },
      onRoom: {
        roundStart(world, self) {
          const spots = world.map.spots('start');
          self.score = 0;
          self.motion.frozenUntil = 0;
          world.place(self, spots[self.seat % spots.length]);
        },
        roundOver(world, self) { self.motion.frozenUntil = world.round.endsAt; },   // stand still through the break
      },
    },
    coin: {
      on: {
        take(world, self, e) {             // first taker wins: a despawned coin hears nothing more this tick
          world.send(e.by, 'score', {});
          world.emit('ding', self.pos, {});
          world.despawn(self);
        },
      },
      onRoom: { roundOver(world, self) { world.despawn(self); } },
    },
  },
  shared: {},
  room: {
    rounds: { seconds: 60, breakSeconds: 8 },
    bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'runner', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) { for (const spot of world.map.spots('coins')) world.spawn('coin', spot, {}); },
    },
  },
  map: './map',
});
