import app from '../app.json';
import { openRoom } from '@homie-rocks/studio/rules/view';
import type rules from './rules';
import { createAppRecords, type AppRecord } from '@homie-rocks/studio/apps';
import { randomId } from '@homie-rocks/studio/links';
type Entry = { choice: string; status: string; amount: number; monthly: boolean };
const room = openRoom<typeof rules>();
const net = room.net;
const role = net.params.role ?? 'customer';
const words: Record<string, string> = app.words;
const config = app.starter;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
const records = createAppRecords<Entry>({ collection: 'entries' });
let rows: AppRecord<Entry>[] = [], busy = false, ready = false, question = 0;
const action = $<HTMLButtonElement>('[data-action]');
document.body.className = role;
document.body.style.setProperty('--tone', config.color);
$('h1').textContent = app.name; $('#intro').textContent = app.blurb;
$('#label').textContent = words.total; action.textContent = words.action;
$('#choice-label').textContent = words.choice;
$('#frequency-label').textContent = words.monthly;
$('#once').textContent = words.once; $('#month').textContent = words.month;
$('#giving-link').textContent = words.give;
$('#giving-link').hidden = config.kind !== 'giving';
$('#frequency').hidden = config.kind !== 'giving';
$('#goal').hidden = config.kind !== 'giving';
$('#controls').hidden = role === 'wall';
const select = $<HTMLSelectElement>('#choice');
function choices() {
 select.replaceChildren();
 const list = config.kind === 'quiz' ? config.questions[question]?.choices ?? [] : config.choices;
 for (const value of list) { const option = document.createElement('option'); option.value = value; option.textContent = value; select.append(option); }
 $('#prompt').textContent = config.kind === 'quiz' ? config.questions[question]?.text ?? words.finished : words.prompt;
 action.hidden = config.kind === 'quiz' && question >= config.questions.length;
}
choices();
function paint() {
 $('[data-count]').textContent = String(rows.length);
 const amount = rows.reduce((n, r) => n + r.data.amount, 0);
 $('#amount').textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: config.currency }).format(amount);
 $('#target').textContent = new Intl.NumberFormat(undefined, { style: 'currency', currency: config.currency }).format(config.goal);
 $<HTMLProgressElement>('progress').max = config.goal; $<HTMLProgressElement>('progress').value = amount;
 $('#goal-label').textContent = words.goal;
 action.disabled = busy || !ready;
 $('#entries').replaceChildren();
 for (const row of rows.slice(-6).reverse()) {
  const li = document.createElement('li');
  li.textContent = `${row.data.choice} · ${row.data.status}${row.data.monthly ? ' · ' + words.month : ''}`;
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
  await records.create({ choice: config.kind === 'quiz' ? `${question + 1}. ${choice}` : choice, status: words.pending, amount: config.kind === 'giving' ? Number(choice) : 0, monthly: $<HTMLSelectElement>('#monthly').value === 'month' }, randomId());
  $('#status').textContent = words.thanks;
  if (config.kind === 'quiz') { question++; choices(); }
  room.command('refresh', {}); await refresh();
 } catch (error) { $('#status').textContent = (error as Error).message; }
 finally { busy = false; paint(); }
};
room.on('refresh', () => { void refresh(); });
net.on('link', () => { void refresh(); });
setInterval(() => { $('#connection').textContent = net.link === 'online' ? words.live : words.reconnecting; void refresh(); }, 2000);
void refresh();
