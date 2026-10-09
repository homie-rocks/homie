import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    radius: f.fix({
      init: 10
    })
  },
  shapes: {
    events: {
      shrink: {
        round: f.u16()
      },
      last: {}
    },
    effects: {
      out: {}
    }
  },
  entities: {
    survivor: {
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
        alive: f.bit({
          init: true
        }),
        score: f.u16({
          score: true
        })
      },
      think(world, self) {
        const d = world.math.norm(world.math.scale(self.pos, -1));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase !== 'live' || !self.alive) return;
        if (world.math.len(self.pos) > world.shared.radius) {
          self.alive = false;
          world.emit('out', self.pos, {});
          return;
        }
        self.score += 1;
        if (world.near(self.pos, 64, 'survivor').filter(p => p.alive).length === 1) world.sendRoom('last', {});
      },
      onRoom: {
        roundStart(world, self) {
          self.alive = true;
          self.score = 0;
          world.place(self, world.map.spots('start')[self.seat % 2]);
        }
      }
    }
  },
  room: {
    rounds: {
      seconds: 18,
      breakSeconds: 2
    },
    bots: {
      keep: 4
    },
    join(ctx, p) {
      return {
        kind: 'survivor',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    },
    on: {
      roundStart(world) {
        world.shared.radius = 10;
        world.after(world.ticks(2), 'shrink', {
          round: world.round.n
        });
      },
      shrink(world, e) {
        if (e.round !== world.round.n || world.round.phase !== 'live') return;
        world.shared.radius = Math.max(1, world.shared.radius - 1);
        world.after(world.ticks(2), 'shrink', {
          round: e.round
        });
      },
      last(world) {
        world.round.end();
      }
    }
  }
});
