import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    wave: f.u16()
  },
  shapes: {
    events: {
      wave: {
        round: f.u16()
      },
      hit: {
        by: f.ref()
      },
      point: {}
    },
    effects: {
      poof: {}
    }
  },
  entities: {
    hero: {
      player: true,
      body: {
        shape: 'circle',
        radius: 0.4,
        maxSpeed: 6,
        move: 'owner'
      },
      input: {
        ax: f.i8(),
        ay: f.i8(),
        fire: f.press()
      },
      fields: {
        score: f.u16({
          score: true
        }),
        ready: f.tick()
      },
      think(world, self) {
        const m = world.near(self.pos, 64, 'slime')[0];
        if (!m) return {};
        const d = world.math.norm(world.math.sub(m.pos, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127,
          fire: true
        };
      },
      tick(world, self) {
        if (self.input.fire && world.tick >= self.ready) {
          self.ready = world.tick + world.ticks(0.5);
          const m = world.near(self.pos, 4, 'slime')[0];
          if (m) world.send(m.id, 'hit', {
            by: self.id
          });
        }
      },
      on: {
        point(world, self) {
          self.score += 1;
        },
        undeliverable() {}
      },
      onRoom: {
        roundStart(world, self) {
          self.score = 0;
        }
      }
    },
    slime: {
      body: {
        shape: 'circle',
        radius: 0.3,
        maxSpeed: 1
      },
      tick(world, self) {
        const p = world.near(self.pos, 64, 'hero')[0];
        if (p) world.sweep(self, world.math.scale(world.math.norm(world.math.sub(p.pos, self.pos)), world.dt));
      },
      on: {
        hit(world, self, e) {
          world.send(e.by, 'point', {});
          world.emit('poof', self.pos, {});
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
      seconds: 100,
      breakSeconds: 2
    },
    bots: {
      keep: 3
    },
    join(ctx, p) {
      return {
        kind: 'hero',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      roundStart(world) {
        world.shared.wave = 0;
        world.after(world.ticks(2), 'wave', {
          round: world.round.n
        });
        world.after(world.ticks(90), 'wave', {
          round: world.round.n
        });
      },
      wave(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.wave += 1;
        for (const spot of world.map.spots('enemies')) world.spawn('slime', spot);
      }
    }
  }
});
