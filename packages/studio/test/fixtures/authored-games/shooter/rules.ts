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
      hit: {
        by: f.ref()
      },
      point: {}
    },
    effects: {
      blast: {
        power: f.u8()
      }
    }
  },
  entities: {
    pilot: {
      player: {
        away: 'think',
        leave: 'bot'
      },
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
        hp: f.u8({
          init: 3
        }),
        ready: f.tick()
      },
      think(world, self) {
        const enemy = world.near(self.pos, 64, 'pilot').find(p => p.id !== self.id);
        if (!enemy) return {
          ax: 0,
          ay: 0,
          fire: false
        };
        const d = world.math.norm(world.math.sub(enemy.pos, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127,
          fire: true
        };
      },
      tick(world, self) {
        if (world.round.phase !== 'live' || world.tick < self.ready || !self.input.fire) return;
        self.ready = world.tick + world.ticks(1);
        world.emit('blast', self.pos, {
          power: 1
        });
        world.sendArea({
          sphere: {
            at: self.pos,
            r: 3
          }
        }, 'hit', {
          by: self.id
        });
      },
      on: {
        hit(world, self, e) {
          if (e.by === self.id) return;
          self.hp = Math.max(0, self.hp - 1);
          if (self.hp === 0) {
            world.send(e.by, 'point', {});
            self.hp = 3;
            world.place(self, world.map.spots('start')[self.seat % 2]);
          }
        },
        point(world, self) {
          self.score += 1;
        },
        undeliverable() {}
      },
      onRoom: {
        roundStart(world, self) {
          self.hp = 3;
          self.score = 0;
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
      keep: 3
    },
    join(ctx, p) {
      return {
        kind: 'pilot',
        at: ctx.map.spots('start')[p.seat % 2]
      };
    }
  }
});
