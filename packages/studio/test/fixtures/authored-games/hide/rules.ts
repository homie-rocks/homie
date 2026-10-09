import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    seeking: f.bit()
  },
  shapes: {
    events: {
      seek: {
        round: f.u16()
      },
      found: {}
    },
    effects: {
      found: {}
    }
  },
  entities: {
    hider: {
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
        out: f.bit(),
        score: f.u16({
          score: true
        })
      },
      think(world, self) {
        const target = world.map.spots('hide')[self.seat % 3];
        const d = world.math.norm(world.math.sub(target, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase === 'live' && world.shared.seeking && !self.out) self.score += 1;
      },
      on: {
        found(world, self) {
          self.out = true;
          world.emit('found', self.pos, {});
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.out = false;
          self.score = 0;
        }
      }
    },
    seeker: {
      body: {
        shape: 'circle',
        radius: 0.4,
        maxSpeed: 3
      },
      tick(world, self) {
        if (!world.shared.seeking || world.round.phase !== 'live') return;
        const p = world.near(self.pos, 64, 'hider').find(p => !p.out);
        if (!p) return;
        world.sweep(self, world.math.scale(world.math.norm(world.math.sub(p.pos, self.pos)), 3 * world.dt));
        if (world.math.dist(self.pos, p.pos) < 1) world.send(p.id, 'found', {});
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
      seconds: 15,
      breakSeconds: 2
    },
    bots: {
      keep: 3
    },
    join(ctx, p) {
      return {
        kind: 'hider',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      roundStart(world) {
        world.shared.seeking = false;
        world.spawn('seeker', {
          x: 0,
          y: 2
        });
        world.after(world.ticks(3), 'seek', {
          round: world.round.n
        });
      },
      seek(world, e) {
        if (e.round === world.round.n) world.shared.seeking = true;
      }
    }
  }
});
