import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shapes: {
    effects: {
      lap: {
        count: f.u16()
      }
    }
  },
  shared: {
    record: f.u16()
  },
  entities: {
    car: {
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
        gate: f.u8(),
        score: f.u16({
          score: true
        })
      },
      think(world, self) {
        const target = world.map.spots('gates')[self.gate];
        const d = world.math.norm(world.math.sub(target, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        const target = world.map.spots('gates')[self.gate];
        if (world.math.dist(self.pos, target) < 1) {
          self.gate = (self.gate + 1) % 4;
          if (self.gate === 0) {
            self.score += 1;
            world.emit('lap', self.pos, {
              count: self.score
            });
          }
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.gate = 0;
          self.score = 0;
          world.place(self, world.map.spots('start')[0]);
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
    join(ctx) {
      return {
        kind: 'car',
        at: ctx.map.spots('start')[0]
      };
    },
    on: {
      roundOver(world, e) {
        for (const r of e.results) world.shared.record = Math.max(world.shared.record, r.score);
      }
    }
  }
});
