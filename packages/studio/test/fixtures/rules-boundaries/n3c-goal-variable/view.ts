import { openRoom } from '@homie-rocks/studio/rules/view';
const room = openRoom();
const board = document.createElement('div'); document.body.append(board);
const feed: string[] = [];
const note = (line: string) => { feed.unshift(line); if (feed.length > 6) feed.pop(); };

type Shown = { goal: 'guard' } | { goal: 'follow'; args: { seat: number } } | { goal: 'visit'; args: { place: string } };
function describe(goal: Shown): string {
  switch (goal.goal) {
    case 'guard': return 'standing guard';
    case 'follow': return `following seat ${goal.args.seat + 0}`;
    case 'visit': return `walking to ${goal.args.place.toUpperCase()}`;
  }
}

let mine = room.me ? room.me.goal : null; // what my companion (seat 1) is doing right now
room.on('goal', (e) => {
  if (e.slot === 1) mine = e.goal;
  const was = e.prev ? `${e.prev.goal} (${e.prev.state})` : 'nothing';
  const how = e.goal.asked ? 'because somebody asked' : e.goal.from === 'floor' ? 'by its own rule' : 'by its own idea';
  note(`seat ${e.slot}: ${was} -> ${describe(e.goal)} ${how}${e.askAt === null ? '' : `, asked at ${e.askAt}`}`);
  if (e.goal.state === 'done') note(`seat ${e.slot} finished ${e.goal.goal}`);
  if (e.goal.state === 'failed') note(`seat ${e.slot} gave up on ${e.goal.goal}`);
});
room.on('ask', (e) => { note(`request ${String(e.ask ?? e.k ?? '')} for seat ${String(e.slot ?? '')}`); });
room.on('say', (e) => { note(`seat ${String(e.slot ?? e.seat ?? '')}: ${String(e.text ?? '')}`); });

function draw() {
  board.replaceChildren();
  room.each('walker', (w) => {
    const row = document.createElement('div');
    const who = w.driver === 'ai' ? 'companion' : w.driver === 'bot' ? 'bot' : 'player';
    const doing = w.goal ? `${describe(w.goal)} since tick ${w.goal.at}${w.goal.asked ? ' (asked)' : ''}` : 'idle';
    row.textContent = `${who} ${w.seat}${w.mine ? ' (you)' : ''}${w.away ? ' (away)' : ''}: ${w.driver === 'ai' ? doing : ''}`;
    if (w.driver === 'ai') for (const b of room.askButtons(w.id)) {
      const button = document.createElement('button');
      button.textContent = b.text;
      button.disabled = w.goal !== null && w.goal.goal === b.k;
      button.onclick = () => room.ask(w.id, b.k, b.args);
      row.append(button);
    }
    board.append(row);
  });
  const log = document.createElement('pre'); log.textContent = `${mine ? mine.goal : ''} ${room.shared.tactic} pace ${room.shared.pace}\n${feed.join('\n')}`; board.append(log);
  requestAnimationFrame(draw);
}
draw();
