import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: { double: f.bit() },
  asks: {
    bonus: {
      state: { round: f.u16() },
      questions: { double: { type: 'noul', instructions: 'Should gems pay double this round?' } },
      floor(state) { return { double: state.round % 2 === 0 }; }
    }
  },
  shapes: {
    view: { gems: f.list(f.ref(), 8) },
    events: {
      take: {
        by: f.ref()
      },
      paid: {
        value: f.u8()
      },
      seed: {
        round: f.u16()
      }
    },
    effects: {
      coin: {
        value: f.u8()
      }
    }
  },
  entities: {
    miner: {
      player: true,
      body: {
        shape: 'circle',
        radius: 0.4,
        maxSpeed: 6,
        move: 'owner'
      },
      input: {
        ax: f.i8(),
        ay: f.i8()
      },
      fields: {
        score: f.u16({
          score: true
        })
      },
      guide: {
        view(world, self) { return { gems: world.near(self.pos, 64, 'gem').slice(0, 8).map(g => g.id) }; },
        floor(world, self, view) {
          const ask = view.asks[0];
          if (ask) return { goal: ask.k, args: ask.args };
          const gem = view.gems[0];
          return gem ? { goal: 'gather', args: { gem } } : {};
        }
      },
      think(world, self) {
        const goal = self.goal;
        if (goal && goal.goal === 'follow') {
          const person = world.near(self.pos, 64, 'miner').find(p => p.seat === goal.args.seat);
          if (!person || world.math.dist(person.pos, self.pos) < 1) { world.goalDone(Boolean(person)); return {}; }
          const d = world.math.norm(world.math.sub(person.pos, self.pos));
          return { ax: d.x * 127, ay: d.y * 127 };
        }
        if (goal && goal.goal === 'gather' && !world.near(self.pos, 64, 'gem').some(g => g.id === goal.args.gem)) world.goalDone(true);
        const gem = world.near(self.pos, 64, 'gem')[0];
        if (!gem) return {};
        const d = world.math.norm(world.math.sub(gem.pos, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase === 'live') for (const gem of world.near(self.pos, 1, 'gem')) world.send(gem.id, 'take', {
          by: self.id
        });
      },
      on: {
        paid(world, self, e) {
          self.score += e.value * (world.shared.double ? 2 : 1);
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0;
        }
      }
    },
    gem: {
      fields: {
        value: f.u8({
          init: 2
        })
      },
      on: {
        take(world, self, e) {
          world.send(e.by, 'paid', {
            value: self.value
          });
          world.emit('coin', self.pos, {
            value: self.value
          });
          world.despawn(self);
        }
      },
      onRoom: {
        roundOver(world, self) {
          world.despawn(self);
        }
      }
    }
  },
  room: {
    rounds: {
      seconds: 12,
      breakSeconds: 2
    },
    bots: {
      keep: 4
    },
    join(ctx, p) {
      return {
        kind: 'miner',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      answer(world, e) { if (e.ask === 'bonus') world.shared.double = e.picks.double; },
      roundStart(world) {
        world.ask('bonus', { round: world.round.n });
        world.after(world.ticks(2), 'seed', {
          round: world.round.n
        });
      },
      seed(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        for (const at of world.map.spots('gems')) world.spawn('gem', at, {
          value: 2
        });
      }
    }
  }
});
