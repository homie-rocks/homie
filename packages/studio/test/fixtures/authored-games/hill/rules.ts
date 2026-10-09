import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    hill: f.u8()
  },
  shapes: {
    events: {
      relocate: {
        round: f.u16()
      }
    },
    effects: {
      moved: {
        index: f.u8()
      }
    }
  },
  entities: {
    climber: {
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
        }),
        paid: f.tick()
      },
      think(world, self) {
        const d = world.math.norm(world.math.sub(world.map.spots('hills')[world.shared.hill], self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase === 'live' && world.tick >= self.paid && world.math.dist(self.pos, world.map.spots('hills')[world.shared.hill]) < 2) {
          self.score += 1;
          self.paid = world.tick + world.ticks(1);
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0;
          self.paid = 0;
        }
      }
    }
  },
  room: {
    rounds: {
      seconds: 15,
      breakSeconds: 2
    },
    bots: {
      keep: 3
    },
    join(ctx, p) {
      return {
        kind: 'climber',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      roundStart(world) {
        world.shared.hill = 0;
        world.after(world.ticks(4), 'relocate', {
          round: world.round.n
        });
      },
      relocate(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.hill = (world.shared.hill + 1) % 3;
        world.emit('moved', world.map.spots('hills')[world.shared.hill], {
          index: world.shared.hill
        });
        world.after(world.ticks(4), 'relocate', {
          round: e.round
        });
      }
    }
  }
});
