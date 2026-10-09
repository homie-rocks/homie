import * as THREE from 'three';
import { damp1 } from '@homie-rocks/camera/spring.js';
import { chamferBox } from '@homie-rocks/geom/chamfer.js';
import { createNetplay } from '@homie-rocks/studio/netplay';
import { createAppRecords, type AppRecord } from '@homie-rocks/studio/apps';
import { appLink, qrSvg, randomId } from '@homie-rocks/studio/links';

type Ticket = { label: string; status: string };
const net = createNetplay<{ light: number }>({ game: 'welcome', maxPlayers: 32, snapshotHz: 2 });
const role = net.params.role ?? 'customer';
document.body.className = role;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const join = $<HTMLButtonElement>('[data-join]');
const next = $<HTMLButtonElement>('[data-next]');
const records = createAppRecords<Ticket>({ collection: 'queue' });
let rows: AppRecord<Ticket>[] = [];
let mine = net.params.ticket ?? '';
let pending = false;
let loaded = false;
let light = 0;
let refreshing = false;
join.hidden = role !== 'customer'; next.hidden = role !== 'staff';
if (role === 'wall') { $('h1').innerHTML = 'You’re in<br>good company.'; $('#intro').textContent = 'A warm welcome, one person at a time. Scan to find your place.'; }
if (role === 'staff') { $('h1').innerHTML = 'Make someone’s<br>day brighter.'; $('#intro').textContent = 'Your welcome desk. Call the next person when you are ready.'; }
function paint() {
  const waiting = rows.filter((r) => r.data.status === 'waiting');
  const called = rows.filter((r) => r.data.status === 'called').at(-1);
  const own = rows.find((r) => r.id === mine);
  $('[data-count]').textContent = String(waiting.length);
  $('#panel-label').textContent = role === 'customer' ? (own ? 'Your ticket' : 'Welcome in') : 'Now welcoming';
  $('#ticket').textContent = role === 'customer' ? own ? `No. ${own.data.label}` : 'Make yourself at home.' : called ? `No. ${called.data.label}` : 'Ready when you are.';
  $('#detail').textContent = own?.data.status === 'called' ? 'It’s your turn. Come on over!' : own ? `You have a place. ${Math.max(0, waiting.findIndex((r) => r.id === mine))} ahead of you.` : role === 'customer' ? 'No account needed. Just a place in line.' : waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'person is' : 'people are'} waiting for a welcome.` : 'The next arrival will appear here.';
  $('.panel').classList.toggle('called', own?.data.status === 'called' || (role !== 'customer' && !!called));
  join.hidden = role !== 'customer' || !!own;
  join.disabled = pending || !loaded; next.disabled = pending || !waiting.length;
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try { rows = await records.list(); loaded = true; $('#status').textContent = ''; paint(); }
  catch (e) { $('#status').textContent = (e as Error).message; }
  finally { refreshing = false; }
}
async function action(fn: () => Promise<unknown>) {
  pending = true; paint();
  try { await fn(); net.send('records-changed'); await refresh(); }
  catch (e) { $('#status').textContent = (e as Error).message; }
  finally { pending = false; paint(); }
}
join.onclick = () => action(async () => {
  mine = randomId();
  const label = mine.slice(0, 4).toUpperCase();
  await records.create({ label, status: 'waiting' }, mine);
  // Build a customer link from a clean address, never from a private staff URL.
  const origin = new URL((window as any).HOMIE_NET.url.replace(/^ws/, 'http')).origin;
  const url = appLink(`/${(window as any).HOMIE_NET.url.split('/')[3]}/open`, { ticket: mine, room: (window as any).HOMIE_NET.room }, origin);
  $('#ticket-qr').innerHTML = qrSvg(url, { title: 'Keep your ticket' });
  parent.postMessage({ type: 'homie-app-ticket', ticket: mine }, '*');
});
next.onclick = () => action(async () => {
  const first = rows.find((r) => r.data.status === 'waiting');
  if (first) await records.update(first, { ...first.data, status: 'called' });
});
// The room carries scene state and change notices; records always come from the authorized database.
net.on('event', (e) => { if (e.k === 'records-changed') { if (net.role === 'host') net.send('records-changed'); void refresh(); } });
net.on('snapshot', (s) => { light = s.d.light; });
net.on('link', () => { void refresh(); });
setInterval(() => { if (net.role === 'host') { light = net.now() / 1000; net.snapshot({ light }); } $('#connection').textContent = net.link === 'online' ? 'Here together · live' : 'Reconnecting…'; }, 500);
setInterval(() => void refresh(), 2000); // recover a missed notice; no dependency on a trusted browser host
void refresh(); paint();

// A single sculptural scene. Queue arrivals unfold the lanterns; the camera follows your context.
const renderer = new THREE.WebGLRenderer({ canvas: $('canvas'), antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.setClearColor('#122f38');
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene(); scene.fog = new THREE.Fog('#122f38', 12, 30);
const camera = new THREE.PerspectiveCamera(37, 1, .1, 60);
scene.add(new THREE.HemisphereLight('#fff1ce', '#214f5b', 3));
const sun = new THREE.DirectionalLight('#ffd2a2', 5); sun.position.set(-3, 8, 6); scene.add(sun);
const mat = (color: string, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness: .45, metalness });
const cream = mat('#f4d8a4'); const green = mat('#9dbda0'); const gold = mat('#e8a953', .35);
const stage = new THREE.Group(); scene.add(stage); stage.position.set(1.5, -.9, 0);
const plinth = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.7, .35, 64), mat('#254952')); plinth.position.y = -.4; stage.add(plinth);
const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, .055, 10, 90), gold); ring.rotation.x = Math.PI / 2; ring.position.y = -.15; stage.add(ring);
const arch = new THREE.Mesh(new THREE.TorusGeometry(1.65, .18, 16, 64, Math.PI), cream); arch.position.set(0, .15, -.8); stage.add(arch);
for (const x of [-1.65, 1.65]) { const leg = new THREE.Mesh(chamferBox(.36, 1.5, .36, .08), cream); leg.position.set(x, -.55, -.8); stage.add(leg); }
const lanterns: THREE.Group[] = [];
for (let i = 0; i < 12; i++) {
  const g = new THREE.Group(); const body = new THREE.Mesh(chamferBox(.42, .7, .42, .08), i % 3 ? green : gold); g.add(body);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(.14, 16, 12), cream); cap.position.y = .5; g.add(cap);
  const angle = i * Math.PI * 2 / 12; g.position.set(Math.sin(angle) * 2.35, 0, Math.cos(angle) * 2.35); stage.add(g); lanterns.push(g);
}
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const vel = { v: 0 }; let distance = 10; let last = performance.now();
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
function draw(now: number) {
  requestAnimationFrame(draw); const dt = Math.min(.05, (now - last) / 1000); last = now;
  const waiting = rows.filter((r) => r.data.status === 'waiting').length;
  distance = damp1(distance, mine ? 8.7 : 10.8, vel, .8, dt);
  const phone = innerWidth < 600;
  camera.position.set(phone ? 7 : 6, phone ? 6 : 5, distance); camera.lookAt(phone ? 1 : -.4, .6, 0);
  stage.position.x = phone ? 1.8 : 2.4;
  stage.rotation.y = reduced.matches ? 0 : Math.sin(light * .12) * .09;
  lanterns.forEach((g, i) => { const target = i < waiting ? 1 : .28; g.scale.y += (target - g.scale.y) * (1 - Math.exp(-dt * 5)); g.position.y = .18 + (reduced.matches ? 0 : Math.sin(now / 1000 + i) * .05); });
  renderer.render(scene, camera);
}
requestAnimationFrame(draw);
