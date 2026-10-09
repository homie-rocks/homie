import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';

// LEDGER: a beat every half second lands on one of six stalls. Tap on the beat to bank a sale for that stall.
// The room keeps everything in maps: sales per stall, the stalls each seat has sold at, a tally per seat keyed
// by seat number, and a short log keyed by beat number. The leader, the best stall and the quietest stall are
// read back out of the maps every beat; old log rows are deleted so the log never holds more than eight.
const STALLS = ['zinc', 'mango', 'apple', 'brine', 'Yarn', '10', '9', '2'];
const BEAT_SECONDS = 0.5;

export default defineRules({
  contract: 2, space: { dims: 2 }, move,
  shared: {
    beat: f.u16(), beatAt: f.tick(), stall: f.text(8),
    sales: f.map(f.u16(), 8), bySeat: f.map(f.u16(), 16), log: f.map(f.text(8), 8),
    first: f.text(8), last: f.text(8), best: f.text(8), quiet: f.text(8), total: f.u32(), seatsSeen: f.u8(), order: f.text(64),
  },
  shapes: {
    events: { beat: { n: f.u16(), i: f.u16() }, sold: { seat: f.u8(), stall: f.text(8), n: f.u16() }, report: { seat: f.u8(), mine: f.map(f.u8(), 8) } },
    commands: { tap: {} },
    effects: { pulse: {}, good: {} },
  },
  entities: {
    drummer: {
      player: { away: 'think', leave: 'bot' },
      fields: { score: f.u16({ score: true }), tapped: f.u16(), pending: f.bit(), mine: f.map(f.u8(), 8), favourite: f.text(8) },
      input: { ax: f.i8(), ay: f.i8(), hit: f.press() },
      body: { shape: 'circle', radius: 0.5, maxSpeed: 3, move: 'owner' },
      think(world, self) {
        const due = world.shared.beat > 0 && world.tick === world.shared.beatAt && self.tapped !== world.shared.beat;
        return { ax: 0, ay: 0, hit: due };
      },
      tick(world, self) {
        const pressed = self.input.hit || self.pending;
        self.pending = false;
        if (!pressed || world.round.phase !== 'live') return;
        const beat = world.shared.beat;
        if (beat === 0 || self.tapped === beat || Math.abs(world.tick - world.shared.beatAt) > 2) return;
        self.tapped = beat;
        const stall = world.shared.stall;
        self.mine[stall] = Math.min(255, (stall in self.mine ? self.mine[stall] ?? 0 : 0) + 1);
        let top = ''; let most = 0;
        for (const [name, count] of Object.entries(self.mine)) if (count > most) { most = count; top = name; }
        self.favourite = top;
        self.score = Math.min(65535, self.score + Object.keys(self.mine).length);
        world.emit('good', self.pos, {});
        world.sendRoom('sold', { seat: self.seat, stall, n: world.round.n });
        world.sendRoom('report', { seat: self.seat, mine: self.mine });
      },
      commands: { tap(world, self) { self.pending = true; } },
      onRoom: {
        roundStart(world, self) { self.score = 0; self.tapped = 0; self.pending = false; self.mine = {}; self.favourite = ''; },
      },
    },
  },
  room: {
    rounds: { seconds: 40, breakSeconds: 4 }, bots: { keep: 4 },
    join(ctx, player) {
      const spots = ctx.map.spots('start');
      return { kind: 'drummer', at: spots[player.seat % spots.length] };
    },
    on: {
      roundStart(world, e) {
        world.shared.beat = 0; world.shared.beatAt = 0; world.shared.stall = '';
        world.shared.sales = {}; world.shared.bySeat = {}; world.shared.log = {};
        world.shared.first = ''; world.shared.last = ''; world.shared.best = ''; world.shared.quiet = ''; world.shared.total = 0; world.shared.seatsSeen = 0; world.shared.order = '';
        world.after(world.ticks(BEAT_SECONDS), 'beat', { n: e.n, i: 1 });
      },
      beat(world, e) {
        if (e.n !== world.round.n || world.round.phase !== 'live') return;
        const stall = STALLS[Math.floor(world.random() * STALLS.length)] ?? 'zinc';
        world.shared.beat = e.i; world.shared.beatAt = world.tick + 4; world.shared.stall = stall;
        // The log keeps the last eight beats: delete the oldest before adding.
        const rows = Object.keys(world.shared.log);
        let oldest = rows[0] ?? '';
        for (const k of rows) if (Number(k) < Number(oldest)) oldest = k;
        const kept: Record<string, string> = {};
        for (const [k, v] of Object.entries(world.shared.log)) if (rows.length < 8 || k !== oldest) kept[k] = v;
        kept[String(e.i)] = stall;
        world.shared.log = kept;
        world.emit('pulse', { x: 0, y: 0, z: 0 }, {});
        world.after(world.ticks(BEAT_SECONDS), 'beat', { n: e.n, i: Math.min(65535, e.i + 1) });
      },
      report(world, e) { world.shared.seatsSeen = Math.max(world.shared.seatsSeen, Object.keys(e.mine).length); },
      sold(world, e) {
        if (e.n !== world.round.n) return;
        const sales = world.shared.sales;
        sales[e.stall] = Math.min(65535, (e.stall in sales ? sales[e.stall] ?? 0 : 0) + 1);
        const seat = String(e.seat);
        world.shared.bySeat[seat] = Math.min(65535, (seat in world.shared.bySeat ? world.shared.bySeat[seat] ?? 0 : 0) + 1);
        const names = Object.keys(sales);
        world.shared.first = names[0] ?? '';
        world.shared.last = names[names.length - 1] ?? '';
        world.shared.order = names.join(',').slice(0, 64);
        let best = ''; let quiet = ''; let hi = -1; let lo = 70000; let total = 0;
        for (const name in sales) {
          const count = sales[name] ?? 0;
          total += count;
          if (count > hi) { hi = count; best = name; }
          if (count < lo) { lo = count; quiet = name; }
        }
        world.shared.best = best; world.shared.quiet = quiet; world.shared.total = total;
        world.shared.seatsSeen = Object.values(world.shared.bySeat).filter((n) => n > 0).length;
      },
    },
  },
});
