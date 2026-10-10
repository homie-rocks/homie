import { Mesh } from '@homie-rocks/nav/Mesh.js';
import { Crowd } from '@homie-rocks/nav/Crowd.js';
import { Grid } from '@homie-rocks/nav/Grid.js';
import type { BakeConfig } from '@homie-rocks/nav/Bake.js';
declare const config: BakeConfig;
const mesh = new Mesh(config, [2, 2, 2]);
const crowd = new Crowd(mesh, .05, .3);
const id = crowd.add([1, 0, 1], { radius: .3, height: 1.8, speed: 3, acceleration: 8, neighbours: 2, separation: 2 });
const home = [1, 0, 1];
const box = { min: [4, -1, 3], max: [6, 3, 7] };
mesh.addObstacle(box);
crowd.target(id, home);
mesh.path(crowd.agent(id)!.position, new Float64Array(home));
new Grid(10, 10, 1, home, undefined, { up: 'z', search: 'jps' }).nearest(home);
// @ts-expect-error Backend state is deliberately inaccessible.
mesh.state;
// @ts-expect-error Backend placement references are deliberately inaccessible.
mesh.locate(home);
// @ts-expect-error Backend state is deliberately inaccessible.
crowd.state;

// @ts-expect-error Coordinate validators are implementation details.
import { point } from '@homie-rocks/nav/Query.js';
// @ts-expect-error The graph codec is private.
import { pack } from '@homie-rocks/nav/State.js';
