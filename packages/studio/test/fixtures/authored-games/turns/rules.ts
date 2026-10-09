import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    turn: f.u8(),
    total: f.u16()
  },
  shapes: {
    commands: {
      pick: {
        n: f.u8()
      }
    },
    events: {
      vote: {
        seat: f.u8(),
        n: f.u8()
      },
      advance: {
        round: f.u16()
      }
    },
    effects: {
      picked: {
        n: f.u8()
      }
    }
  },
  entities: {
    guest: {
      player: true,
      body: {
        shape: 'circle',
        radius: 0.4,
        maxSpeed: 1
      },
      input: {
        ax: f.i8(),
        ay: f.i8()
      },
      fields: {
        score: f.u16({
          score: true
        }),
        voted: f.tick()
      },
      think() {
        return {
          ax: 0,
          ay: 0
        };
      },
      tick(world, self) {
        if (world.round.phase === 'live' && self.driver !== 'person' && self.seat === world.shared.turn && self.voted < world.tick) {
          self.voted = world.tick + world.ticks(3);
          world.sendRoom('vote', {
            seat: self.seat,
            n: 1
          });
        }
      },
      commands: {
        pick(world, self, e) {
          if (e.n < 1 || e.n > 3) return;
          world.sendRoom('vote', {
            seat: self.seat,
            n: e.n
          });
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0;
          self.voted = 0;
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
        kind: 'guest',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      roundStart(world) {
        world.shared.turn = 0;
        world.shared.total = 0;
        world.after(world.ticks(3), 'advance', {
          round: world.round.n
        });
      },
      vote(world, e) {
        if (world.round.phase !== 'live' || e.seat !== world.shared.turn) return;
        world.shared.total += e.n;
        world.shared.turn = (world.shared.turn + 1) % 4;
        world.emit('picked', {
          x: 0,
          y: 0
        }, {
          n: e.n
        });
      },
      advance(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.turn = (world.shared.turn + 1) % 4;
        world.after(world.ticks(3), 'advance', {
          round: e.round
        });
      }
    }
  }
});
