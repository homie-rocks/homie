import app from '../app.json';
import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
import { createAppRecords, type AppRecord } from '@homie-rocks/studio/apps';
import { randomId } from '@homie-rocks/studio/links';
type Entry = { choice: string; status: string };
const room = openRoom<typeof rules>();
const net = room.net;
const role = net.params.role ?? 'customer';
const words: Record<string, string> = app.words;
const config = app.starter;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const records = createAppRecords<Entry>({ collection: 'entries' });
let rows: AppRecord<Entry>[] = [], busy = false, ready = false;
const action = $<HTMLButtonElement>('[data-action]');
document.body.className = role;
document.body.style.setProperty('--tone', config.color);
$('h1').textContent = app.name; $('#intro').textContent = app.blurb;
$('#label').textContent = words.total; action.textContent = words.action;
$('#choice-label').textContent = words.choice;
$('#controls').hidden = role === 'wall';
const select = $<HTMLSelectElement>('#choice');
function choices() {
 select.replaceChildren();
 const list = config.choices;
 for (const value of list) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); }
 $('#prompt').textContent = words.prompt;
}
choices();
function paint() {
 $('[data-count]').textContent = String(rows.length);
 action.disabled = busy || !ready;
 $('#entries').replaceChildren();
 for (const row of rows.slice(-6).reverse()) {
  const li = document.createElement('li');
  li.textContent = `${row.data.choice} · ${row.data.status}`;
  if (role === 'staff' && row.data.status !== words.done) {
   const button = document.createElement('button'); button.textContent = words.complete;
   button.onclick = () => { void records.update(row, { ...row.data, status: words.done }).then(refresh).catch(e => { $('#status').textContent = e.message; }); }; li.append(button);
  }
  $('#entries').append(li);
 }
}
async function refresh() {
 try { rows = await records.list(); ready = true; paint(); net.playable(); }
 catch (error) { $('#status').textContent = (error as Error).message; }
}
action.onclick = async () => {
 busy = true; paint();
 try {
  const choice = select.value;
  await records.create({ choice, status: words.pending }, randomId());
  $('#status').textContent = words.thanks;
  room.command('refresh', {}); await refresh();
 } catch (error) { $('#status').textContent = (error as Error).message; }
 finally { busy = false; paint(); }
};
room.on('refresh', () => { void refresh(); });
net.on('link', () => { void refresh(); });
setInterval(() => { $('#connection').textContent = net.link === 'online' ? words.live : words.reconnecting; void refresh(); }, 2000);
void refresh();
