import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shapes: {
    events: {
      tag: {
        by: f.ref()
      }
    },
    effects: {
      tagged: {}
    }
  },
  entities: {
    skater: {
      player: {
        away: 'think',
        leave: 'despawn'
      },
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
        it: f.bit(),
        until: f.tick(),
        score: f.u16({
          score: true
        })
      },
      think(world, self) {
        const other = world.near(self.pos, 64, 'skater').find(p => p.id !== self.id);
        if (!other) return {};
        const d = world.math.norm(world.math.sub(other.pos, self.pos));
        const sign = self.it ? 1 : -1;
        return {
          ax: d.x * 127 * sign,
          ay: d.y * 127 * sign
        };
      },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if (!self.it) {
          self.score += 1;
          return;
        }
        if (world.tick < self.until) return;
        const next = world.near(self.pos, 1.5, 'skater').find(p => p.id !== self.id);
        if (next) {
          world.send(next.id, 'tag', {
            by: self.id
          });
          self.it = false;
        }
      },
      on: {
        tag(world, self) {
          self.it = true;
          self.until = world.tick + world.ticks(2);
          world.emit('tagged', self.pos, {});
        },
        undeliverable(world, self) {
          self.it = true;
        },
        leave(world, self) {
          if (self.it) {
            const next = world.near(self.pos, 64, 'skater').find(p => p.id !== self.id);
            if (next) world.send(next.id, 'tag', {
              by: self.id
            });
          }
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.it = self.seat === 0;
          self.until = world.tick + world.ticks(2);
          self.score = 0;
        }
      }
    }
  },
  room: {
    rounds: {
      seconds: 10,
      breakSeconds: 2
    },
    bots: {
      keep: 4
    },
    join(ctx, p) {
      return {
        kind: 'skater',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    }
  }
});
