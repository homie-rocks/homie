import { defineRules, f } from '@homie-rocks/studio/rules';
import { move } from './move';
export default defineRules({
  contract: 2,
  space: {
    dims: 2
  },
  move,
  shared: {
    captures: f.list(f.u16(), 2)
  },
  shapes: {
    events: {
      take: {
        by: f.ref(),
        team: f.u8()
      },
      carry: {},
      capture: {
        team: f.u8()
      }
    },
    effects: {
      flag: {
        team: f.u8()
      }
    }
  },
  entities: {
    scout: {
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
        team: f.u8(),
        carrying: f.bit(),
        score: f.u16({
          score: true
        })
      },
      think(world, self) {
        const goal = world.map.spots('start')[self.carrying ? self.team : 1 - self.team];
        const d = world.math.norm(world.math.sub(goal, self.pos));
        return {
          ax: d.x * 127,
          ay: d.y * 127
        };
      },
      tick(world, self) {
        if (world.round.phase !== 'live') return;
        if (self.carrying) {
          if (world.math.dist(self.pos, world.map.spots('start')[self.team]) < 1) {
            self.carrying = false;
            self.score += 1;
            world.sendRoom('capture', {
              team: self.team
            });
          }
        } else {
          for (const flag of world.near(self.pos, 1, 'flag')) if (flag.team !== self.team) world.send(flag.id, 'take', {
            by: self.id,
            team: self.team
          });
        }
      },
      on: {
        carry(world, self) {
          self.carrying = true;
        }
      },
      onRoom: {
        roundStart(world, self) {
          self.carrying = false;
          self.score = 0;
        }
      }
    },
    flag: {
      fields: {
        team: f.u8(),
        ready: f.tick()
      },
      on: {
        take(world, self, e) {
          if (world.tick < self.ready) return;
          self.ready = world.tick + world.ticks(4);
          world.send(e.by, 'carry', {});
        },
        undeliverable(world, self) {
          self.ready = 0;
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
      seconds: 15,
      breakSeconds: 2
    },
    bots: {
      keep: 4
    },
    join(ctx, p) {
      return {
        kind: 'scout',
        at: ctx.map.spots('start')[p.seat % 2],
        fields: {
          team: p.seat % 2
        }
      };
    },
    on: {
      roundStart(world) {
        world.shared.captures = [0, 0];
        for (let team = 0; team < 2; team++) world.spawn('flag', world.map.spots('start')[team], {
          team
        });
      },
      capture(world, e) {
        const list = world.shared.captures.slice();
        list[e.team] += 1;
        world.shared.captures = list;
        world.emit('flag', world.map.spots('start')[e.team], {
          team: e.team
        });
      }
    }
  }
});
