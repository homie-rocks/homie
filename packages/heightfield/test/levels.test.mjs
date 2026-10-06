// A structure with more than one floor: what is under and over a point on every level, rays and movement through a
// doorway, nodes that share a plan position, a route checked and walked with the bot's real arrival radius, marks
// drawn on every level, and staged positions checked before a capture (src/Levels.ts, Route.ts, Markers.ts, Pose.ts).
// Run after `npm run build`: node --test packages/heightfield/test/levels.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkStructure, createWorld, supported } from '@homie-rocks/heightfield/Levels.js';
import { checkNav, checkRoute, findRoute, nearestNode, traverse, turnPoint } from '@homie-rocks/heightfield/Route.js';
import { markerSeenFrom, markerSpots, ringStrips } from '@homie-rocks/heightfield/Markers.js';
import { groundPose, placePose, poseProblem, sightProblem } from '@homie-rocks/heightfield/Pose.js';

/**
 * A building, 10 m by 8 m: one room, a doorway in its south wall, an L-shaped roof (so there is an inside
 * corner to cut and a courtyard open to the sky), and a stair from the courtyard up to the roof.
 */
const BUILDING = {
  v: 1, units: 'metres',
  floors: [
    { id: 'room', level: 0, y: 0.1, thickness: 0.1, x0: 0, z0: 0, x1: 10, z1: 8 },
    { id: 'roof-a', level: 1, y: 3.2, thickness: 0.2, x0: 0, z0: 0, x1: 10, z1: 4 },
    { id: 'roof-b', level: 1, y: 3.2, thickness: 0.2, x0: 0, z0: 4, x1: 4, z1: 8 },
  ],
  walls: [
    { id: 'south wall', x0: 0, z0: 0, x1: 10, z1: 0, y0: 0, y1: 3 },
    { id: 'north wall', x0: 0, z0: 8, x1: 10, z1: 8, y0: 0, y1: 3 },
    { id: 'west wall', x0: 0, z0: 0, x1: 0, z1: 8, y0: 0, y1: 3 },
    { id: 'east wall', x0: 10, z0: 0, x1: 10, z1: 8, y0: 0, y1: 3 },
  ],
  openings: [{ id: 'door', x0: 4.3, z0: 0, x1: 5.7, z1: 0, y0: 0, y1: 2.2 }],
  connectors: [
    { id: 'front door', kind: 'door', width: 1, from: { floor: 'ground', x: 5, y: 0.1, z: -1 }, to: { floor: 'room', x: 5, y: 0.1, z: 1 } },
    { id: 'stair', kind: 'stair', width: 1.6, from: { floor: 'room', x: 9, y: 0.1, z: 7 }, to: { floor: 'roof-b', x: 4, y: 3.2, z: 7 } },
  ],
};
const COVER = { kind: 'box', id: 'cover wall', x: 8, y: 0.1, z: 1.5, hx: 1, hz: 0.15, h: 1.2 };
const flat = { heightAt: () => 0 };
const world = createWorld({ ground: flat, structures: [{ structure: BUILDING }], proxies: [COVER] });
const BODY = { radius: 0.35, height: 1.8, step: 0.3 };
const BOT = { ...BODY, maxDrop: 0.5, arrival: 0.4, speed: 3 };
const NAV = {
  nodes: [
    { id: 'out', x: 5, y: 0, z: -2 }, { id: 'hall', x: 5, y: 0.1, z: 1 }, { id: 'foot', x: 9.5, y: 0.1, z: 7 },
    { id: 'top', x: 3, y: 3.2, z: 7 }, { id: 'elbow', x: 3, y: 3.2, z: 3 }, { id: 'far', x: 9, y: 3.2, z: 3 },
    { id: 'under', x: 3, y: 0.1, z: 3 }, // the room, straight below `elbow`
  ],
  edges: [{ a: 'out', b: 'hall' }, { a: 'hall', b: 'foot' }, { a: 'foot', b: 'top' }, { a: 'top', b: 'elbow' }, { a: 'elbow', b: 'far' }, { a: 'hall', b: 'under' }],
};

test('the contract: a well-formed structure has nothing wrong, and the slips a picture hides are named', () => {
  assert.deepEqual(checkStructure(BUILDING, { clearance: 1.8, radius: 0.35 }), []);
  const bad = structuredClone(BUILDING);
  bad.floors.push({ id: 'loft', level: 1, y: 1.6, thickness: 0.1, x0: 0, z0: 0, x1: 10, z1: 8 });
  bad.openings.push({ id: 'hatch', x0: 20, z0: 20, x1: 21, z1: 20, y0: 0, y1: 1 });
  bad.connectors.push({ id: 'stair', kind: 'stair', width: 0.4, from: { floor: 'room', x: 2, y: 0.1, z: 2 }, to: { floor: 'attic', x: 2, y: 3.2, z: 6 } });
  const said = checkStructure(bad, { clearance: 1.8, radius: 0.35 }).join('\n');
  assert.match(said, /floor room: 1\.40 m of headroom/);
  assert.match(said, /opening hatch: it lies on no wall/);
  assert.match(said, /opening hatch: 1\.00 m high/);
  assert.match(said, /connector stair: that id is used twice/);
  assert.match(said, /connector stair: 0\.4 m wide/);
  assert.match(said, /names floor attic, which is not in the structure/);
  // A stair that comes up under a slab with no hole cut for it.
  const capped = structuredClone(BUILDING);
  capped.floors[2].x1 = 10;
  assert.match(checkStructure(capped, { clearance: 1.8, radius: 0.35 }).join('\n'), /connector stair: .* of headroom .*cut a hole/);
});

test('every surface over a point, lowest first, each with its ceiling', () => {
  // Outside: only the ground, under open sky.
  assert.deepEqual(world.surfacesAt(5, -3), [{ y: 0, ceiling: Infinity, id: 'ground', level: 0, kind: 'ground' }]);
  // Indoors under the roof: the ground is buried under the slab, the room has 2.9 m, the roof has the sky.
  const s = world.surfacesAt(2, 2);
  assert.deepEqual(s.map((q) => [q.id, q.y, q.ceiling]), [['ground', 0, 0], ['room', 0.1, 3], ['roof-a', 3.2, Infinity]]);
  // The courtyard: room floor under the sky.
  assert.deepEqual(world.surfacesAt(7, 5).map((q) => q.id), ['ground', 'room']);
  assert.equal(world.surfacesAt(7, 5)[1].ceiling, Infinity);
  // Half way up the stair there is a third thing to stand on.
  const mid = world.surfacesAt(6.5, 7).find((q) => q.id === 'stair');
  assert.ok(Math.abs(mid.y - 1.65) < 1e-9 && mid.kind === 'connector');
  // The floor under the cover wall has no room; its top can be stood on.
  const c = world.surfacesAt(8, 1.5);
  assert.equal(c.find((q) => q.id === 'room').ceiling, 0.1);
  assert.ok(Math.abs(c.find((q) => q.id === 'cover wall').y - 1.3) < 1e-9);
  // Which one a body is on is decided by its feet, not by which is highest.
  assert.equal(world.standOn(2, 0.1, 2, 0.3).id, 'room');
  assert.equal(world.standOn(2, 3.2, 2, 0.3).id, 'roof-a');
  assert.equal(world.standOn(2, -5, 2, 0.3), null);
  assert.equal(supported(world, 3.8, 3.2, 6, 0.35, 0.3, 0.5), false, 'a body 20 cm from the roof\'s edge overhangs it');
  assert.equal(supported(world, 3, 3.2, 6, 0.35, 0.3, 0.5), true);
});

test('rays and movement pass through the doorway and stop at the wall beside it', () => {
  assert.ok(Math.abs(world.ray(5, 1.2, -3, 0, 0, 1) - 11) < 1e-9, 'through the door, to the far wall');
  assert.ok(Math.abs(world.ray(2, 1.2, -3, 0, 0, 1) - 3) < 1e-9, 'beside the door, the near wall');
  assert.ok(Math.abs(world.ray(5, 2.6, -3, 0, 0, 1) - 3) < 1e-9, 'over the door\'s head, the wall again');
  assert.ok(Math.abs(world.ray(2, 1, 2, 0, 1, 0) - 2) < 1e-9, 'up from the room: the ceiling at 3 m');
  assert.ok(Math.abs(world.ray(2, 6, 2, 0, -1, 0) - 2.8) < 1e-9, 'down from above: the roof, not the room');
  assert.equal(world.blocked(5, -1, 5, 1, 0.3, 1.8, 0.35), null);
  assert.equal(world.blocked(2, -1, 2, 1, 0.3, 1.8, 0.35), 'south wall');
  assert.equal(world.blocked(5.6, -1, 5.6, 1, 0.3, 1.8, 0.35), 'south wall', 'a body 0.35 m wide does not fit 0.1 m from the jamb');
  assert.equal(world.blocked(5, -1, 5, 1, 0.3, 2.6, 0.35), 'south wall', 'nor one taller than the door');
  assert.equal(world.blocked(2, -1, 2, 1, 3.5, 5, 0.35), null, 'over the wall, nothing');
  // The same building, turned a quarter and moved: the door is found where it now is.
  const turned = createWorld({ ground: flat, structures: [{ structure: BUILDING, at: { x: 100, y: 5, z: 50, yaw: Math.PI / 2 } }] });
  assert.deepEqual(turned.surfacesAt(100 + 2, 50 - 2).map((q) => [q.id, Math.round(q.y * 10) / 10]), [['ground', 0], ['room', 5.1], ['roof-a', 8.2]]);
  assert.ok(Math.abs(turned.ray(97, 6.2, 45, 1, 0, 0) - 11) < 1e-9, 'through the turned doorway');
  assert.ok(Math.abs(turned.ray(97, 6.2, 48, 1, 0, 0) - 3) < 1e-9);
});

test('two nodes at one plan position: the nearest node is the one on the level asked from', () => {
  // (`foot` is half a metre past the stair's low end, so a body turning 0.4 m short of it is already off the stair.)
  assert.equal(nearestNode(NAV, 3.2, 0.1, 3.1, 1).id, 'under');
  assert.equal(nearestNode(NAV, 3.2, 3.2, 3.1, 1).id, 'elbow');
  assert.equal(nearestNode(NAV, 3.2, 1.6, 3.1, 0.2).id, 'under', 'between levels with none in tolerance: the nearest in three dimensions');
  assert.deepEqual(findRoute(NAV, 'under', 'elbow').map((n) => n.id), ['under', 'hall', 'foot', 'top', 'elbow'], 'three metres apart, and 25 m by the stair');
  assert.equal(findRoute(NAV, 'out', 'nowhere'), null);
  // Standing under the roof node is not having reached it.
  const r = traverse(world, [NAV.nodes[6], NAV.nodes[4]], BOT);
  assert.equal(r.why, 'wrong level');
});

test('a route is checked and walked as the bot really turns: a corner cut within the arrival radius falls off the roof', () => {
  const byId = Object.fromEntries(NAV.nodes.map((n) => [n.id, n]));
  const roof = [byId.top, byId.elbow, byId.far];
  // With the bot's real arrival radius, every waypoint and every leg is on the roof...
  assert.deepEqual(checkRoute(world, roof, BOT), []);
  assert.equal(traverse(world, roof, BOT).why, 'arrived');
  // ...and with a looser one the SAME waypoints fail: it turns 2.5 m short of the elbow and crosses the courtyard.
  const loose = { ...BOT, arrival: 2.5 };
  assert.deepEqual(turnPoint(byId.top, byId.elbow, 2.5), { x: 3, y: 3.2, z: 5.5 });
  const found = checkRoute(world, roof, loose);
  assert.deepEqual(found.map((p) => [p.part, p.index, p.kind]), [['chord', 1, 'unsupported']], 'the legs are fine; the chord is not');
  assert.match(found[0].why, /turning 2\.5 m short of waypoint 1/);
  const fall = traverse(world, roof, loose);
  assert.equal(fall.why, 'fell');
  assert.ok(fall.at.x > 4 && fall.at.z > 4, `it fell into the courtyard (at ${fall.at.x.toFixed(2)}, ${fall.at.z.toFixed(2)})`);
  assert.equal(fall.index, 2, 'while heading for the waypoint after the corner');
});

test('the whole building: in by the door, up the stair, across the roof; and the graph check finds a bad corner anywhere', () => {
  const path = findRoute(NAV, 'out', 'far');
  assert.deepEqual(path.map((n) => n.id), ['out', 'hall', 'foot', 'top', 'elbow', 'far']);
  assert.deepEqual(checkRoute(world, path, BOT), []);
  const run = traverse(world, path, BOT);
  assert.equal(run.why, 'arrived');
  assert.ok(Math.abs(run.at.y - 3.2) < 1e-9 && run.metres > 20);
  assert.deepEqual(checkNav(world, NAV, BOT), []);
  const said = checkNav(world, NAV, { ...BOT, arrival: 2.5 }).map((p) => p.why).join('\n');
  assert.match(said, /top to elbow to far, turning 2\.5 m short of elbow/);
  assert.match(said, /out to hall to foot, turning 2\.5 m short of hall: south wall is in the way/, 'and a turn made before the doorway meets the wall');
  // A leg drawn straight through the wall beside the door.
  assert.match(checkRoute(world, [{ x: 2, y: 0, z: -2 }, { x: 2, y: 0.1, z: 2 }], BOT)[0].why, /south wall is in the way/);
});

test('a zone ring is drawn on every level with room over it, and a person under the roof can see it', () => {
  // Over a point indoors: the room and the roof. Never the ground buried under the slab.
  assert.deepEqual(markerSpots(world, 5, 0.5, 1.8).map((m) => [m.id, m.level]), [['room', 0], ['roof-a', 1]]);
  assert.deepEqual(markerSpots(world, 8, 1.5, 1.6).map((m) => m.id), ['cover wall', 'roof-a'], 'on the cover wall, not inside it');
  const strips = ringStrips(world, 5, 4, 3.5, { segments: 96, clearance: 1.8 });
  const ids = new Set(strips.map((s) => s.id));
  assert.ok(ids.has('room') && ids.has('roof-a') && ids.has('roof-b'), [...ids].join(', '));
  assert.ok(strips.every((s) => s.xyz.length >= 6 && s.xyz.length % 3 === 0));
  const eye = { x: 5, y: 1.8, z: 1.5 }; // standing in the room, under the roof, a metre from the ring
  const all = markerSeenFrom(world, eye, strips.filter((s) => s.id === 'room'), 6);
  assert.deepEqual([all.seen, all.id], [true, 'room']);
  // What "the highest surface" draws: the same ring, on the roof only. It is near, and it cannot be seen.
  const topOnly = strips.filter((s) => s.level === 1);
  const hidden = markerSeenFrom(world, eye, topOnly, 6);
  assert.equal(hidden.seen, false);
  assert.ok(hidden.near > 0, 'the mark is close; it is the slab that hides it');
  assert.equal(markerSeenFrom(world, { x: 5, y: 5, z: 1.5 }, topOnly, 6).seen, true, 'from the roof, the roof\'s arc');
  // A ring out in the open is one closed strip on the ground.
  const open = ringStrips(world, 40, 40, 5, { segments: 24, clearance: 1.8 });
  assert.equal(open.length, 1);
  assert.equal(open[0].xyz.length, 25 * 3);
});

test('a staged position is grounded and checked before a capture uses it', () => {
  // The floor is chosen by the height asked for; with none, the highest with room.
  assert.equal(groundPose(world, 3, 3, BODY, 0).y, 0.1);
  assert.equal(groundPose(world, 3, 3, BODY, 3).y, 3.2);
  assert.equal(groundPose(world, 3, 3, BODY).y, 3.2);
  assert.equal(groundPose(createWorld(), 3, 3, BODY), null);
  // The authored spot is the corner of the cover wall: refused, with the reason, and not silently used.
  const corner = placePose(world, { x: 9.1, z: 1.7, y: 0 }, BODY);
  assert.deepEqual([corner.ok, corner.pose, corner.why], [false, null, 'inside cover wall']);
  // Given leave to look around, the nearest good spot, how far it moved, and what was wrong.
  const fixed = placePose(world, { x: 9.1, z: 1.7, y: 0 }, BODY, { search: 1 });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.why, 'inside cover wall');
  assert.ok(fixed.moved > 0 && fixed.moved <= 1 && fixed.pose.y === 0.1);
  assert.equal(poseProblem(world, fixed.pose, BODY), null);
  assert.deepEqual(placePose(world, { x: 3, z: 3, y: 0 }, BODY), { ok: true, pose: { x: 3, y: 0.1, z: 3 }, moved: 0, why: null });
  // Other ways to be nowhere.
  assert.match(poseProblem(world, { x: 3, y: 1.1, z: 3 }, BODY), /floating 1\.00 m/);
  assert.match(poseProblem(world, { x: 3.9, y: 3.2, z: 6 }, BODY), /over an edge/);
  assert.match(poseProblem(world, { x: 0.1, y: 0.1, z: 3 }, BODY), /inside west wall/);
  const hill = createWorld({ ground: { heightAt: (x) => Math.max(0, 3 - Math.abs(x) * 0.2) } });
  assert.match(poseProblem(hill, { x: 0, y: 1, z: 0 }, BODY), /inside the ground \(it is 2\.00 m above the feet/);
  assert.equal(placePose(hill, { x: 0, z: 0 }, BODY).pose.y, 3, 'grounded: the floor height is computed, not authored');
  // The game's own rule runs last and its sentence is reported as written.
  const rule = (p) => (p.z < 0 ? 'the south yard is out of bounds' : null);
  assert.equal(placePose(world, { x: 5, z: -3 }, BODY, { rule }).why, 'the south yard is out of bounds');
  assert.equal(placePose(world, { x: 5, z: -3 }, BODY).ok, true);
  // And the camera: inside the cover wall, or with a slab between it and its subject.
  assert.equal(sightProblem(world, { x: 8, y: 0.6, z: 1.5 }, { x: 8, y: 1, z: 4 }), 'the camera is inside cover wall');
  assert.match(sightProblem(world, { x: 3, y: 1.7, z: 2 }, { x: 3, y: 4, z: 2 }), /something solid is 1\.30 m along/);
  assert.equal(sightProblem(world, { x: 3, y: 1.7, z: 2 }, { x: 5, y: 1, z: 3 }), null);
});
