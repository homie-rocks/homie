// ODD ONE UP: a party game in turns. Each turn everybody secretly picks a number from 1 to 9. The highest number
// that only one player picked wins the turn. The dealer moves on one seat each turn and wins a turn nobody wins.
// Five turns make a round.
import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

const TURNS = 5;
const PICK_SECONDS = 6;
const SHOW_SECONDS = 3;
const WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

export default defineRules({
  contract: 2,

  space: { dims: 2 },
  move,
  shapes: {
    events: {
      open: { turn: f.u16() }, close: { turn: f.u16() }, next: { turn: f.u16() },
      picked: { id: f.ref(), n: f.u8(), turn: f.u16() }, win: { turn: f.u16() }, sync: {},
    },
    commands: { pick: { n: f.u8() } },
    effects: { reveal: { winner: f.ref(), n: f.u8() } },
  },
  entities: {
    guest: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), pick: f.u8(), pickedTurn: f.u16(), said: f.text(8) },
      motion: { frozenUntil: f.tick() },
      input: { ax: f.i8(), ay: f.i8() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 6, move: 'owner' },
      tick(world, self) {
        // Bots, and people who are away, pick for themselves a moment into the turn.
        if (world.shared.phase !== 1 || self.pickedTurn === world.shared.turn) return;
        if (self.driver === 'person' && !self.away) return;
        if (world.random() < 0.1) {
          self.pick = 1 + Math.floor(world.random() * 9);
          self.pickedTurn = world.shared.turn;
          world.sendRoom('picked', { id: self.id, n: self.pick, turn: self.pickedTurn });
        }
      },
      think() { return { ax: 0, ay: 0 }; },
      commands: {
        pick(world, self, e) {
          if (world.shared.phase !== 1 || self.pickedTurn === world.shared.turn) return;
          self.said = WORDS[e.n - 1].slice(0, 8);
          self.pick = e.n;
          self.pickedTurn = world.shared.turn;
          world.sendRoom('picked', { id: self.id, n: e.n, turn: world.shared.turn });
        },
      },
      on: {
        win(world, self) { self.score += 1; },
      },
      onRoom: {
        roundStart(world, self) { self.score = 0; self.pick = 0; self.pickedTurn = 0; },
      },
    },
  },
  shared: {
    turn: f.u16(), phase: f.u8(), dealer: f.u8(), closesAt: f.tick(),
    picks: f.map(f.u8(), 32), order: f.list(f.ref(), 32), lastWinner: f.ref(),
  },
  room: {
    rounds: { seconds: 0, breakSeconds: 5 },
    bots: { keep: 3 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'guest', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world) {
        world.shared.turn = 0;
        world.shared.phase = 0;
        world.shared.picks = {};
        world.shared.lastWinner = '';
        world.after(world.ticks(1), 'next', { turn: 1 });
      },
      next(world, e) {
        if (world.round.phase !== 'live' || e.turn !== world.shared.turn + 1) return;
        if (e.turn > TURNS) { world.round.end(); return; }
        const guests = world.inBox({ min: { x: -60, y: -60 }, max: { x: 60, y: 60 } }, 'guest');
        world.shared.turn = e.turn;
        world.shared.phase = 1;
        world.shared.picks = {};
        world.shared.order = guests.map((g) => g.id).slice(0, 32);
        world.shared.dealer = guests.length > 0 ? (e.turn - 1) % guests.length : 0;
        world.shared.closesAt = world.tick + world.ticks(PICK_SECONDS);
        world.after(world.ticks(PICK_SECONDS), 'close', { turn: e.turn });
      },
      picked(world, e) {
        if (world.shared.phase !== 1 || e.turn !== world.shared.turn) return;
        if (e.id in world.shared.picks) return;
        if (Object.keys(world.shared.picks).length >= 32) return;
        world.shared.picks = { ...world.shared.picks, [e.id]: e.n };
        // Everybody is in: do not wait for the clock.
        if (Object.keys(world.shared.picks).length >= world.shared.order.length) world.after(1, 'close', { turn: e.turn });
      },
      close(world, e) {
        if (world.shared.phase !== 1 || e.turn !== world.shared.turn) return;
        world.shared.phase = 2;
        const counts: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        const picks = world.shared.picks;
        for (const id of Object.keys(picks)) counts[picks[id]] += 1;
        let best = 0;
        for (let n = 9; n >= 1; n -= 1) if (counts[n] === 1) { best = n; break; }
        let winner = '';
        if (best > 0) { for (const id of Object.keys(picks)) if (picks[id] === best) winner = id; }
        else if (world.shared.order.length > 0) winner = world.shared.order[world.shared.dealer % world.shared.order.length];
        world.shared.lastWinner = winner;
        if (winner !== '') world.send(winner, 'win', { turn: e.turn });
        world.emit('reveal', { x: 0, y: 0 }, { winner, n: best });
        world.after(world.ticks(SHOW_SECONDS), 'next', { turn: e.turn + 1 });
      },
      undeliverable(world, e) {
        // The winner left before the point landed. Nobody takes it.
        if (e.event === 'win') world.shared.lastWinner = '';
      },
    },
  },
});
