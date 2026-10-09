import { defineRules, f } from '@homie-rocks/studio/rules';

// fault: module let
let memory = 0;
// end-fault

// fault: load call
function own() { return 1; }
const memory = own();
// end-fault

export default defineRules({ contract: 2, space: { dims: 2 },
  entities: { dot: { fields: { count: f.u16(), list: f.list(f.u8(), 2) }, tick(world, self) {
// fault: Date
{ const n = Date.now(); }
// end-fault

// fault: Math.sin
{ const n = Math.sin(1); }
// end-fault

// fault: exponent
{ const n = 2 ** 3; }
// end-fault

// fault: query write
{ world.near(self.pos, 1, 'dot')[0].count = 4; }
// end-fault

// fault: await
{ await Promise.resolve(1); }
// end-fault

// fault: undeclared event
{ world.send(self.id, 'missing', {}); }
// end-fault

// fault: computed constructor
{ const key = 'con' + 'structor'; const a = []; const n = a[key]; }
// end-fault

// fault: optional constructor
{ const key = 'con' + 'structor'; const a = []; const n = a?.[key]; }
// end-fault

// fault: destructured constructor
{ const { constructor: c } = self; }
// end-fault

// fault: prototype literal
{ const n = { __proto__: self }; }
// end-fault

// fault: infinite loop
{ while (true) {} }
// end-fault

// fault: concat doubling
{ let a = [1]; for (let i = 0; i < 30; i += 1) a = a.concat(a); }
// end-fault

// fault: near budget
{ for (let i = 0; i < 100000; i += 1) world.near(self.pos, 64); }
// end-fault

  } } }, room: { start(world) { world.spawn('dot', { x: 0, y: 0, z: 0 }); } },
});
